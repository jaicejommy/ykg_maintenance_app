# backend/api/equipment_routes.py
import logging
from typing import List, Optional
from datetime import datetime, timezone
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status, Query

from backend.auth import get_current_user, require_role
from backend.database import fetch_all, fetch_one, execute
from backend.models.equipment_models import EquipmentCreate, EquipmentUpdate, EquipmentOut
from backend.constants import ROLES

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
    current_user: dict = Depends(get_current_user),
) -> List[EquipmentOut]:
    """Return equipment matching search and active_only filters."""
    try:
        conditions: list[str] = []
        params: list = []

        if active_only:
            conditions.append("is_active = ?")
            params.append(1)

        if search:
            conditions.append("full_path LIKE ?")
            params.append(f"%{search}%")

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        query = f"""
            SELECT id, enterprise_name, site, area, work_center, work_unit, equipment_id, 
                   full_path, is_active, created_by, created_date 
            FROM equipment_hierarchy 
            {where} 
            ORDER BY enterprise_name ASC, site ASC, area ASC, work_center ASC, work_unit ASC, equipment_id ASC
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
