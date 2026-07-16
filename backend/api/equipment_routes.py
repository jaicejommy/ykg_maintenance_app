# backend/api/equipment_routes.py
import logging
from typing import List, Optional
from datetime import datetime, timezone
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File

from backend.auth import get_current_user, require_role
from backend.database import fetch_all, fetch_one, execute, get_connection
from backend.models.equipment_models import EquipmentCreate, EquipmentUpdate, EquipmentOut
from backend.constants import ROLES, MAX_BULK_EQUIPMENT_ROWS, MAX_BULK_EQUIPMENT_FILE_MB, ALLOWED_EQUIPMENT_SORT_COLUMNS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/equipment", tags=["equipment"])

def _row_to_equipment_out(row) -> EquipmentOut:
    return EquipmentOut(
        id=row["id"],
        enterprise_name=row["enterprise_name"],
        site=row["site"],
        area=row["area"],
        work_center=row["work_center"],
        work_unit=row["work_unit"],
        equipment_id=row["equipment_id"],
        full_path=row["full_path"],
        is_active=row["is_active"],
        created_by=row["created_by"],
        created_date=row["created_date"]
    )

@router.get("", status_code=status.HTTP_200_OK)
async def list_equipment(
    search: Optional[str] = None,
    active_only: bool = True,
    sort_by: str = "enterprise_name",
    sort_order: str = "asc",
    current_user: dict = Depends(get_current_user),
) -> List[EquipmentOut]:
    """Return equipment matching search and active_only filters."""
    try:
        if sort_by not in ALLOWED_EQUIPMENT_SORT_COLUMNS:
            raise HTTPException(status_code=400, detail="Invalid sort_by column.")
        if sort_order not in ("asc", "desc"):
            raise HTTPException(status_code=400, detail="sort_order must be 'asc' or 'desc'.")

        conditions: list[str] = []
        params: list = []

        if active_only:
            conditions.append("is_active = ?")
            params.append(1)

        if search:
            conditions.append("full_path LIKE ?")
            params.append(f"%{search}%")

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        if sort_by == "enterprise_name":
            order_clause = f"ORDER BY enterprise_name {sort_order.upper()}, site ASC, area ASC, work_center ASC, work_unit ASC, equipment_id ASC"
        else:
            order_clause = f"ORDER BY {sort_by} {sort_order.upper()}, id ASC"

        query = f"""
            SELECT id, enterprise_name, site, area, work_center, work_unit, equipment_id, 
                   full_path, is_active, created_by, created_date 
            FROM equipment_hierarchy 
            {where} 
            {order_clause}
        """
        
        rows = fetch_all(query, tuple(params))
        return [_row_to_equipment_out(row) for row in rows]
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error listing equipment.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving equipment.",
        )

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_equipment(
    payload: EquipmentCreate,
    current_user: dict = Depends(require_role(ROLES["ADMIN"]))
) -> EquipmentOut:
    """Create a new equipment hierarchy entry."""
    try:
        full_path = f"{payload.enterprise_name.strip()} > {payload.site.strip()} > {payload.area.strip()} > {payload.work_center.strip()} > {payload.work_unit.strip()} > {payload.equipment_id.strip()}"
        created_date = datetime.now(timezone.utc).isoformat()
        created_by = current_user["sub"]

        try:
            new_id = execute(
                """
                INSERT INTO equipment_hierarchy 
                (enterprise_name, site, area, work_center, work_unit, equipment_id, full_path, is_active, created_by, created_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """,
                (payload.enterprise_name.strip(), payload.site.strip(), payload.area.strip(), 
                 payload.work_center.strip(), payload.work_unit.strip(), payload.equipment_id.strip(), 
                 full_path, created_by, created_date)
            )
        except sqlite3.IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This equipment already exists in the hierarchy."
            )

        row = fetch_one("SELECT * FROM equipment_hierarchy WHERE id = ?", (new_id,))
        return _row_to_equipment_out(row)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error creating equipment.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while creating equipment."
        )

REQUIRED_BULK_HEADERS = {
    'enterprise_name',
    'site',
    'area',
    'work_center',
    'work_unit',
    'equipment_id',
}

BULK_FIELD_LABELS = {
    'enterprise_name': 'Enterprise Name',
    'site':            'Site',
    'area':            'Area',
    'work_center':     'Work Center',
    'work_unit':       'Work Unit',
    'equipment_id':    'Equipment ID',
}

def _parse_csv_content(content: bytes) -> list[dict]:
    import csv, io
    text   = content.decode('utf-8-sig')  # utf-8-sig handles Excel BOM automatically
    reader = csv.DictReader(io.StringIO(text))
    # Normalize header names: strip whitespace, lowercase, replace spaces with underscores
    if reader.fieldnames:
        reader.fieldnames = [
            h.strip().lower().replace(' ', '_')
            for h in reader.fieldnames
        ]
    return [dict(row) for row in reader]

def _validate_bulk_row(row: dict, row_number: int) -> list[str]:
    errors = []
    for field, label in BULK_FIELD_LABELS.items():
        value = (row.get(field) or '').strip()
        if not value:
            errors.append(f"Row {row_number}: '{label}' is empty.")
        elif len(value) > 200:
            errors.append(f"Row {row_number}: '{label}' exceeds 200 characters.")
    return errors

def _is_blank_row(row: dict) -> bool:
    return all(
        not (row.get(field) or '').strip()
        for field in REQUIRED_BULK_HEADERS
    )

@router.post("/bulk")
async def bulk_upload_equipment(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role(ROLES["ADMIN"]))
):
    try:
        # ── 1. File validation ──────────────────────────────
        filename = (file.filename or '').lower()
        if not filename.endswith('.csv'):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Only .csv files are accepted. "
                    "If you are using Excel, go to File -> Save As -> "
                    "CSV (Comma delimited) first."
                )
            )

        content = await file.read()

        if len(content) > MAX_BULK_EQUIPMENT_FILE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"File exceeds the maximum allowed size of {MAX_BULK_EQUIPMENT_FILE_MB}MB."
            )

        if not content.strip():
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")

        # ── 2. Parse ────────────────────────────────────────
        raw_rows = _parse_csv_content(content)

        if not raw_rows:
            raise HTTPException(status_code=400, detail="No data rows found in the file.")

        # ── 3. Header validation ────────────────────────────
        present = set(raw_rows[0].keys())
        missing = REQUIRED_BULK_HEADERS - present
        if missing:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Missing required column(s): {', '.join(sorted(missing))}. "
                    f"Required: Enterprise Name, Site, Area, Work Center, Work Unit, Equipment ID"
                )
            )

        # ── 4. Filter blank rows ────────────────────────────
        data_rows = [r for r in raw_rows if not _is_blank_row(r)]

        if not data_rows:
            raise HTTPException(
                status_code=400,
                detail="No data rows found after skipping blank rows."
            )

        # ── 5. Row count limit ──────────────────────────────
        if len(data_rows) > MAX_BULK_EQUIPMENT_ROWS:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"File contains {len(data_rows)} rows, "
                    f"which exceeds the maximum of {MAX_BULK_EQUIPMENT_ROWS}. "
                    f"Please split the file and upload in batches."
                )
            )

        # ── 6. Validate all rows before inserting anything ──
        all_errors = []
        for i, row in enumerate(data_rows, start=2):  # row 1 = header
            all_errors.extend(_validate_bulk_row(row, i))

        if all_errors:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Validation failed. No records were inserted. Fix the errors below and re-upload.",
                    "errors":  all_errors,
                }
            )

        # ── 7. Insert ───────────────────────────────────────
        inserted = 0
        skipped  = 0
        now      = datetime.utcnow().isoformat()

        conn = get_connection()
        try:
            for row in data_rows:
                ename  = row['enterprise_name'].strip()
                site   = row['site'].strip()
                area   = row['area'].strip()
                wc     = row['work_center'].strip()
                wu     = row['work_unit'].strip()
                eq_id  = row['equipment_id'].strip()
                path   = f"{ename} > {site} > {area} > {wc} > {wu} > {eq_id}"

                try:
                    conn.execute(
                        """
                        INSERT INTO equipment_hierarchy
                               (enterprise_name, site, area, work_center, work_unit,
                                equipment_id, full_path, is_active, created_by, created_date)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                        """,
                        (ename, site, area, wc, wu, eq_id, path,
                         current_user["sub"], now)
                    )
                    inserted += 1
                except sqlite3.IntegrityError:
                    skipped += 1
            conn.commit()
        finally:
            conn.close()

        return {
            "detail":   f"Upload complete. {inserted} equipment(s) added, {skipped} duplicate(s) skipped.",
            "inserted": inserted,
            "skipped":  skipped,
            "total":    inserted + skipped,
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error in POST /api/equipment/bulk")
        raise HTTPException(
            status_code=500,
            detail="Bulk upload failed unexpectedly. Please try again."
        )


@router.put("/{equipment_id}", status_code=status.HTTP_200_OK)
async def update_equipment(
    equipment_id: int,
    payload: EquipmentUpdate,
    current_user: dict = Depends(require_role(ROLES["ADMIN"]))
) -> EquipmentOut:
    """Update equipment (only is_active)."""
    try:
        row = fetch_one("SELECT * FROM equipment_hierarchy WHERE id = ?", (equipment_id,))
        if not row:
            raise HTTPException(status_code=404, detail="Equipment not found.")

        if payload.is_active is not None:
            execute("UPDATE equipment_hierarchy SET is_active = ? WHERE id = ?", (int(payload.is_active), equipment_id))
        
        updated_row = fetch_one("SELECT * FROM equipment_hierarchy WHERE id = ?", (equipment_id,))
        return _row_to_equipment_out(updated_row)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error updating equipment.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while updating equipment."
        )

@router.delete("/{equipment_id}", status_code=status.HTTP_200_OK)
async def delete_equipment(
    equipment_id: int,
    current_user: dict = Depends(require_role(ROLES["ADMIN"]))
):
    """Hard delete equipment."""
    try:
        row = fetch_one("SELECT equipment_id, full_path FROM equipment_hierarchy WHERE id = ?", (equipment_id,))
        if not row:
            raise HTTPException(status_code=404, detail="Equipment not found.")

        # Check if active maintenance records use this equipment
        record = fetch_one(
            """
            SELECT 1 FROM maintenance_records 
            WHERE equipment_id = ? AND equipment_full_path = ? AND deleted_date IS NULL
            LIMIT 1
            """,
            (row["equipment_id"], row["full_path"])
        )
        if record:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete equipment that has existing maintenance records. Deactivate it instead."
            )

        execute("DELETE FROM equipment_hierarchy WHERE id = ?", (equipment_id,))
        return {"detail": "Equipment deleted."}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error deleting equipment.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while deleting equipment."
        )
