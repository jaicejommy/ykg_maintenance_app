# backend/api/record_routes.py
# Maintenance record CRUD routes and attachment download.

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from backend.auth import get_current_user, require_role
from backend.constants import (
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES,
    ATTACHMENTS_DIR,
    ROLES,
)
from backend.database import execute, fetch_all, fetch_one
from backend.models.record_models import RecordCreate, RecordOut, RecordUpdate

logger = logging.getLogger(__name__)

router = APIRouter(tags=["records"])

_admin_only = require_role(ROLES["ADMIN"])
_engineer_or_admin = require_role(ROLES["ADMIN"], ROLES["ENGINEER"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_max_upload_bytes() -> int:
    """Return the maximum allowed upload size in bytes from the environment."""
    try:
        mb = float(os.getenv("MAX_UPLOAD_SIZE_MB", "10"))
    except ValueError:
        mb = 10.0
    return int(mb * 1024 * 1024)


def _now_utc_str() -> str:
    """Return the current UTC timestamp as an ISO 8601 string."""
    return datetime.now(tz=timezone.utc).isoformat()


def _validate_attachment(file: UploadFile) -> None:
    """Validate attachment extension and MIME type. Raises HTTPException on failure."""
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"File type '{ext}' is not allowed. "
                f"Accepted: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
            ),
        )
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"MIME type '{file.content_type}' is not allowed. "
                "Upload a PDF, Excel spreadsheet, JPG, or PNG."
            ),
        )


def _save_attachment(file: UploadFile) -> tuple[str, str]:
    """Read, size-check, and persist an uploaded file. Returns (saved_path, original_name)."""
    max_bytes = _get_max_upload_bytes()
    contents = file.file.read()

    if len(contents) > max_bytes:
        max_mb = max_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File exceeds the maximum allowed size of {max_mb:.0f} MB.",
        )

    ext = os.path.splitext(file.filename or "")[1].lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(ATTACHMENTS_DIR, unique_name)

    os.makedirs(ATTACHMENTS_DIR, exist_ok=True)
    with open(save_path, "wb") as f:
        f.write(contents)

    return save_path, file.filename or unique_name


def _row_to_record_out(row) -> RecordOut:
    """Convert a sqlite3.Row to a RecordOut schema instance."""
    return RecordOut(
        id=row["id"],
        maintenance_type=row["maintenance_type"],
        created_time=row["created_time"] or "",
        equipment_id=row["equipment_id"],
        operating_conditions=row["operating_conditions"],
        inventory_consumables=row["inventory_consumables"],
        responsible_person=row["responsible_person"],
        planned_start=row["planned_start"],
        planned_end=row["planned_end"],
        last_updated_time=row["last_updated_time"],
        remarks=row["remarks"],
        attachment_path=row["attachment_path"],
        attachment_original_name=row["attachment_original_name"],
        created_by=row["created_by"],
        created_date=row["created_date"],
        updated_by=row["updated_by"],
        updated_date=row["updated_date"],
    )


# ---------------------------------------------------------------------------
# GET /api/records — list all active records with optional filters
# ---------------------------------------------------------------------------

@router.get("/api/records")
async def list_records(
    type: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
) -> list[RecordOut]:
    """Return all active (non-deleted) maintenance records.

    Supports optional query parameters:
    - ``type``: filter by maintenance_type ('Planned' or 'Conducted')
    - ``search``: keyword search across equipment_id, responsible_person, remarks
    """
    try:
        conditions = ["deleted_date IS NULL"]
        params: list = []

        if type:
            conditions.append("maintenance_type = ?")
            params.append(type)

        if search:
            keyword = f"%{search}%"
            conditions.append(
                "(equipment_id LIKE ? OR responsible_person LIKE ? OR remarks LIKE ?)"
            )
            params.extend([keyword, keyword, keyword])

        where_clause = " AND ".join(conditions)
        # ORDER BY created_time DESC for chronological ordering of the domain field.
        query = f"SELECT * FROM maintenance_records WHERE {where_clause} ORDER BY id DESC"  # noqa: S608
        rows = fetch_all(query, tuple(params))
        return [_row_to_record_out(r) for r in rows]

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error listing records.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving records.",
        )


# ---------------------------------------------------------------------------
# POST /api/records — create a new record
# ---------------------------------------------------------------------------

@router.post("/api/records", status_code=status.HTTP_201_CREATED)
async def create_record(
    maintenance_type: str = Form(...),
    equipment_id: str = Form(...),
    responsible_person: str = Form(...),
    planned_start: Optional[str] = Form(None),
    planned_end: Optional[str] = Form(None),
    operating_conditions: Optional[str] = Form(None),
    inventory_consumables: Optional[str] = Form(None),
    remarks: Optional[str] = Form(None),
    attachment: Optional[UploadFile] = File(None),
    current_user: dict = Depends(_engineer_or_admin),
) -> RecordOut:
    """Create a new maintenance record. Accepts multipart/form-data.

    created_time is set server-side to the current UTC timestamp.
    It is the maintenance-domain creation timestamp, conceptually distinct from
    created_date (the audit-trail row-insertion timestamp). Both are set to the
    same UTC moment at creation — they serve different conceptual roles.
    """
    try:
        # Validate text fields through Pydantic model.
        # planned_start and planned_end cross-field ordering is validated inside RecordCreate.
        validated = RecordCreate(
            maintenance_type=maintenance_type,
            equipment_id=equipment_id,
            responsible_person=responsible_person,
            planned_start=planned_start,
            planned_end=planned_end,
            operating_conditions=operating_conditions,
            inventory_consumables=inventory_consumables,
            remarks=remarks,
        )

        attachment_path = None
        attachment_original_name = None

        if attachment and attachment.filename:
            _validate_attachment(attachment)
            attachment_path, attachment_original_name = _save_attachment(attachment)

        # Both created_time (domain field) and created_date (audit field) are set
        # to the same UTC moment. They serve different conceptual roles even when
        # numerically equal: created_time tracks the maintenance activity's log start;
        # created_date tracks the database row insertion.
        now_iso = _now_utc_str()
        username = current_user["sub"]

        new_id = execute(
            """
            INSERT INTO maintenance_records (
                maintenance_type, created_time, equipment_id,
                operating_conditions, inventory_consumables,
                responsible_person, planned_start, planned_end,
                remarks, attachment_path, attachment_original_name,
                created_by, created_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                validated.maintenance_type,
                now_iso,
                validated.equipment_id,
                validated.operating_conditions,
                validated.inventory_consumables,
                validated.responsible_person,
                validated.planned_start,
                validated.planned_end,
                validated.remarks,
                attachment_path,
                attachment_original_name,
                username,
                now_iso,
            ),
        )

        new_row = fetch_one(
            "SELECT * FROM maintenance_records WHERE id = ?", (new_id,)
        )
        return _row_to_record_out(new_row)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error creating maintenance record.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while saving the record.",
        )


# ---------------------------------------------------------------------------
# PUT /api/records/{id} — update an existing record
# ---------------------------------------------------------------------------

@router.put("/api/records/{record_id}", status_code=status.HTTP_200_OK)
async def update_record(
    record_id: int,
    maintenance_type: Optional[str] = Form(None),
    equipment_id: Optional[str] = Form(None),
    responsible_person: Optional[str] = Form(None),
    planned_start: Optional[str] = Form(None),
    planned_end: Optional[str] = Form(None),
    operating_conditions: Optional[str] = Form(None),
    inventory_consumables: Optional[str] = Form(None),
    remarks: Optional[str] = Form(None),
    attachment: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
) -> RecordOut:
    """Update a maintenance record.

    - Engineers may only update records they created (created_by == their username).
    - Administrators may update any record.
    - last_updated_time is always system-assigned; never accepted from client input.
    - created_time is never included in the UPDATE — it is immutable once set at creation.
    """
    try:
        role = current_user.get("role")
        username = current_user["sub"]

        # Only Engineers and Administrators may edit
        if role not in (ROLES["ADMIN"], ROLES["ENGINEER"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to edit records.",
            )

        row = fetch_one(
            "SELECT * FROM maintenance_records WHERE id = ? AND deleted_date IS NULL",
            (record_id,),
        )
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Record {record_id} not found.",
            )

        # Engineers may only edit their own records
        if role == ROLES["ENGINEER"] and row["created_by"] != username:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Engineers may only edit records they created.",
            )

        # Validate updated text fields via Pydantic.
        # planned_start/planned_end ordering is validated inside RecordUpdate.
        update_data = RecordUpdate(
            maintenance_type=maintenance_type,
            equipment_id=equipment_id,
            responsible_person=responsible_person,
            planned_start=planned_start,
            planned_end=planned_end,
            operating_conditions=operating_conditions,
            inventory_consumables=inventory_consumables,
            remarks=remarks,
        )

        now_iso = _now_utc_str()

        # Build the full UPDATE statement with all domain fields explicitly listed.
        # This ensures created_time is never touched and last_updated_time is always
        # system-assigned — not derived from any client-submitted field.
        execute(
            """
            UPDATE maintenance_records
            SET maintenance_type = ?,
                equipment_id = ?,
                operating_conditions = ?,
                inventory_consumables = ?,
                responsible_person = ?,
                planned_start = ?,
                planned_end = ?,
                remarks = ?,
                last_updated_time = ?,
                updated_by = ?,
                updated_date = ?
            WHERE id = ? AND deleted_date IS NULL
            """,
            (
                update_data.maintenance_type if update_data.maintenance_type is not None else row["maintenance_type"],
                update_data.equipment_id if update_data.equipment_id is not None else row["equipment_id"],
                update_data.operating_conditions if update_data.operating_conditions is not None else row["operating_conditions"],
                update_data.inventory_consumables if update_data.inventory_consumables is not None else row["inventory_consumables"],
                update_data.responsible_person if update_data.responsible_person is not None else row["responsible_person"],
                update_data.planned_start,
                update_data.planned_end,
                update_data.remarks,
                now_iso,
                username,
                now_iso,
                record_id,
            ),
        )

        # Handle new attachment separately (after main field update)
        if attachment and attachment.filename:
            _validate_attachment(attachment)
            att_path, att_name = _save_attachment(attachment)
            execute(
                "UPDATE maintenance_records SET attachment_path = ?, attachment_original_name = ? WHERE id = ?",
                (att_path, att_name, record_id),
            )

        updated_row = fetch_one(
            "SELECT * FROM maintenance_records WHERE id = ?", (record_id,)
        )
        return _row_to_record_out(updated_row)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error updating record id %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while updating the record.",
        )


# ---------------------------------------------------------------------------
# DELETE /api/records/{id} — soft delete
# ---------------------------------------------------------------------------

@router.delete("/api/records/{record_id}", status_code=status.HTTP_200_OK)
async def delete_record(
    record_id: int,
    current_user: dict = Depends(_admin_only),
):
    """Soft-delete a record. Only Administrators may delete records.
    Sets deleted_by and deleted_date; the row and file are never physically removed.
    """
    try:
        row = fetch_one(
            "SELECT id FROM maintenance_records WHERE id = ? AND deleted_date IS NULL",
            (record_id,),
        )
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Record {record_id} not found.",
            )

        username = current_user["sub"]
        execute(
            "UPDATE maintenance_records SET deleted_by = ?, deleted_date = ? WHERE id = ?",
            (username, _now_utc_str(), record_id),
        )
        return {"detail": f"Record {record_id} deleted successfully."}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error deleting record id %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while deleting the record.",
        )


# ---------------------------------------------------------------------------
# GET /api/attachments/{id} — stream attachment file
# ---------------------------------------------------------------------------

@router.get("/api/attachments/{record_id}")
async def download_attachment(
    record_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Stream the attachment file linked to a record using FileResponse.

    Returns HTTP 404 if the record has no attachment or the file is missing.
    """
    try:
        row = fetch_one(
            "SELECT attachment_path, attachment_original_name "
            "FROM maintenance_records WHERE id = ? AND deleted_date IS NULL",
            (record_id,),
        )
        if not row or not row["attachment_path"]:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No attachment found for this record.",
            )

        file_path = row["attachment_path"]
        if not os.path.isfile(file_path):
            logger.error(
                "Attachment file missing on disk for record %s: %s",
                record_id,
                file_path,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment file could not be found on the server.",
            )

        return FileResponse(
            path=file_path,
            filename=row["attachment_original_name"] or os.path.basename(file_path),
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error serving attachment for record id %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving the attachment.",
        )
