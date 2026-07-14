# backend/api/record_routes.py
# Maintenance record CRUD routes and attachment management.

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import ValidationError

from backend.auth import get_current_user, require_role
from backend.constants import (
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES,
    ATTACHMENTS_DIR,
    MAX_ATTACHMENTS_PER_RECORD,
    ROLES,
)
from backend.database import execute, fetch_all, fetch_one
from backend.models.record_models import AttachmentOut, BulkDeleteRequest, RecordCreate, RecordOut, RecordUpdate, DeletedRecordOut

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
    """Validate attachment extension and MIME type. Raises HTTP 400 on failure.

    Called once per file in a batch before any file is written to disk.
    All files in the batch must pass before any are persisted.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"File '{file.filename}': type '{ext}' is not allowed. "
                f"Accepted: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
            ),
        )
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"File '{file.filename}': MIME type '{file.content_type}' is not allowed. "
                "Upload a PDF, Excel spreadsheet, JPG, or PNG."
            ),
        )


def _read_and_check_size(file: UploadFile) -> bytes:
    """Read file contents and validate size. Raises HTTP 400 if too large.

    Must be called after _validate_attachment(), before _persist_file().
    Reading is separated from persisting so that all files in a batch can be
    validated in memory before any are written to disk — no partial saves.
    """
    max_bytes = _get_max_upload_bytes()
    contents = file.file.read()
    if len(contents) > max_bytes:
        max_mb = max_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File '{file.filename}' exceeds the maximum allowed size of {max_mb:.0f} MB.",
        )
    return contents


def _persist_file(contents: bytes, original_filename: str) -> tuple[str, str, int]:
    """Write pre-validated bytes to disk with a UUID filename.

    Returns (save_path, original_filename, file_size_bytes).
    Only called after all files in a batch have passed validation.
    """
    ext = os.path.splitext(original_filename or "")[1].lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"
    save_path = os.path.join(ATTACHMENTS_DIR, unique_name)
    os.makedirs(ATTACHMENTS_DIR, exist_ok=True)
    with open(save_path, "wb") as f:
        f.write(contents)
    return save_path, original_filename or unique_name, len(contents)


def _get_attachment_count(record_id: int) -> int:
    """Return the number of record_attachments rows for a given record."""
    row = fetch_one(
        "SELECT COUNT(*) AS cnt FROM record_attachments WHERE record_id = ?",
        (record_id,),
    )
    return row["cnt"] if row else 0


def _row_to_record_out(row, attachment_count: int = 0) -> RecordOut:
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
        attachment_count=attachment_count,
    )


# ---------------------------------------------------------------------------
# GET /api/records — list all active records with optional filters
# ---------------------------------------------------------------------------

@router.get("/api/records")
async def list_records(
    status: str = "active",
    type: Optional[str] = None,
    search: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
) -> list:
    """Return all active (non-deleted) maintenance records.

    Each record includes a lightweight attachment_count (COUNT subquery) so the
    dashboard can display "N files" without fetching full attachment metadata.

    Supports optional query parameters:
    - ``type``: filter by maintenance_type ('Planned' or 'Conducted')
    - ``search``: keyword search across equipment_id, responsible_person, remarks
    """
    try:
        role = current_user.get("role")
        if status == "active":
            conditions = ["deleted_date IS NULL"]
        elif status == "deleted":
            if role != ROLES["ADMIN"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only Administrators can view deleted records.",
                )
            conditions = ["deleted_date IS NOT NULL"]
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="status must be 'active' or 'deleted'."
            )
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
        # Subquery COUNT keeps the dashboard payload light — no full attachment list here.
        query = (  # noqa: S608
            "SELECT maintenance_records.*, "
            "COALESCE((SELECT COUNT(*) FROM record_attachments "
            "           WHERE record_id = maintenance_records.id), 0) AS attachment_count "
            f"FROM maintenance_records WHERE {where_clause} ORDER BY id DESC"
        )
        rows = fetch_all(query, tuple(params))
        
        if status == "deleted":
            return [
                DeletedRecordOut(
                    id=r["id"],
                    maintenance_type=r["maintenance_type"],
                    equipment_id=r["equipment_id"],
                    created_time=r["created_time"] or "",
                    responsible_person=r["responsible_person"],
                    created_by=r["created_by"],
                    created_date=r["created_date"],
                    deleted_by=r["deleted_by"],
                    deleted_date=r["deleted_date"]
                ) for r in rows
            ]
        else:
            return [_row_to_record_out(r, attachment_count=r["attachment_count"]) for r in rows]

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
    attachments: list[UploadFile] = File(default=[]),
    current_user: dict = Depends(_engineer_or_admin),
) -> RecordOut:
    """Create a new maintenance record. Accepts multipart/form-data.

    created_time is set server-side to the current UTC timestamp.
    It is the maintenance-domain creation timestamp, conceptually distinct from
    created_date (the audit-trail row-insertion timestamp). Both are set to the
    same UTC moment at creation — they serve different conceptual roles.

    Bug 1 fix: pydantic.ValidationError is caught explicitly and returned as 422
    so field-level errors surface to the client rather than being swallowed as 500.
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

        # Filter out empty UploadFile entries (browser sends empty entry when no files chosen)
        valid_attachments = [a for a in attachments if a.filename]

        if len(valid_attachments) > MAX_ATTACHMENTS_PER_RECORD:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"A record may have at most {MAX_ATTACHMENTS_PER_RECORD} attachments. "
                    f"{len(valid_attachments)} files were submitted."
                ),
            )

        # Phase 1: validate ALL files (extension + MIME + size) before writing any.
        for att in valid_attachments:
            _validate_attachment(att)

        file_payloads: list[tuple[bytes, str]] = []
        for att in valid_attachments:
            contents = _read_and_check_size(att)
            file_payloads.append((contents, att.filename or ""))

        # Phase 2: all files passed — persist them.
        saved_files: list[tuple[str, str, int]] = []
        for contents, original_name in file_payloads:
            save_path, original_name, size = _persist_file(contents, original_name)
            saved_files.append((save_path, original_name, size))

        # Both created_time (domain field) and created_date (audit field) are set to
        # the same UTC moment. They serve different conceptual roles even when numerically
        # equal: created_time tracks the maintenance activity's log start; created_date
        # tracks the database row insertion.
        now_iso = _now_utc_str()
        username = current_user["sub"]

        new_id = execute(
            """
            INSERT INTO maintenance_records (
                maintenance_type, created_time, date_time,
                equipment_id, operating_conditions, inventory_consumables,
                responsible_person, planned_start, planned_end,
                remarks, attachment_path, attachment_original_name,
                created_by, created_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                validated.maintenance_type,
                now_iso,
                now_iso,  # date_time — legacy NOT NULL column; kept for DB constraint only, never read
                validated.equipment_id,
                validated.operating_conditions,
                validated.inventory_consumables,
                validated.responsible_person,
                validated.planned_start,
                validated.planned_end,
                validated.remarks,
                None,   # attachment_path — legacy column, new uploads go to record_attachments
                None,   # attachment_original_name — legacy column
                username,
                now_iso,
            ),
        )

        # Insert one record_attachments row per uploaded file.
        for save_path, original_name, size in saved_files:
            execute(
                "INSERT INTO record_attachments "
                "(record_id, file_path, original_filename, file_size_bytes, uploaded_by, uploaded_date) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (new_id, save_path, original_name, size, username, now_iso),
            )

        new_row = fetch_one(
            "SELECT * FROM maintenance_records WHERE id = ?", (new_id,)
        )
        return _row_to_record_out(new_row, attachment_count=_get_attachment_count(new_id))

    except HTTPException:
        raise
    except ValidationError as exc:
        # Bug 1 fix: surface Pydantic field-level errors as 422 instead of swallowing as 500.
        messages = "; ".join(e["msg"] for e in exc.errors())
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=messages,
        )
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
    attachments: list[UploadFile] = File(default=[]),
    current_user: dict = Depends(get_current_user),
) -> RecordOut:
    """Update a maintenance record.

    - Engineers may only update records they created (created_by == their username).
    - Administrators may update any record.
    - last_updated_time is always system-assigned; never accepted from client input.
    - created_time is never included in the UPDATE — it is immutable once set at creation.
    - New files in this request are ADDED to existing attachments; they do not replace them.
    - MAX_ATTACHMENTS_PER_RECORD is enforced as the total (existing + new).
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

        # Filter empty UploadFile entries
        valid_attachments = [a for a in attachments if a.filename]

        # Enforce MAX_ATTACHMENTS_PER_RECORD as total (existing + new)
        existing_count = _get_attachment_count(record_id)
        if existing_count + len(valid_attachments) > MAX_ATTACHMENTS_PER_RECORD:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Adding {len(valid_attachments)} file(s) would exceed the maximum of "
                    f"{MAX_ATTACHMENTS_PER_RECORD} attachments per record "
                    f"(currently {existing_count})."
                ),
            )

        # Phase 1: validate ALL new files before writing any
        for att in valid_attachments:
            _validate_attachment(att)

        file_payloads: list[tuple[bytes, str]] = []
        for att in valid_attachments:
            contents = _read_and_check_size(att)
            file_payloads.append((contents, att.filename or ""))

        now_iso = _now_utc_str()

        # Update the record's domain and audit fields
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

        # Phase 2: all files passed — persist and insert attachment rows
        for contents, original_name in file_payloads:
            save_path, original_name, size = _persist_file(contents, original_name)
            execute(
                "INSERT INTO record_attachments "
                "(record_id, file_path, original_filename, file_size_bytes, uploaded_by, uploaded_date) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (record_id, save_path, original_name, size, username, now_iso),
            )

        updated_row = fetch_one(
            "SELECT * FROM maintenance_records WHERE id = ?", (record_id,)
        )
        return _row_to_record_out(updated_row, attachment_count=_get_attachment_count(record_id))

    except HTTPException:
        raise
    except ValidationError as exc:
        # Bug 1 fix: surface Pydantic field-level errors as 422 instead of swallowing as 500.
        messages = "; ".join(e["msg"] for e in exc.errors())
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=messages,
        )
    except Exception:
        logger.exception("Error updating record id %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while updating the record.",
        )


# ---------------------------------------------------------------------------
# PATCH /api/records/{record_id}/restore — restore soft deleted record
# ---------------------------------------------------------------------------

@router.patch("/api/records/{record_id}/restore", status_code=status.HTTP_200_OK)
async def restore_record(
    record_id: int,
    current_user: dict = Depends(_admin_only),
):
    """Restore a soft-deleted record. Administrator only."""
    try:
        row = fetch_one(
            "SELECT id, deleted_date, equipment_id FROM maintenance_records WHERE id = ?",
            (record_id,)
        )
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Record not found."
            )
        
        if row["deleted_date"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Record is not deleted and cannot be restored."
            )
            
        execute(
            "UPDATE maintenance_records SET deleted_by = NULL, deleted_date = NULL WHERE id = ?",
            (record_id,)
        )
        return {"detail": "Record restored successfully.", "id": record_id}
        
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error restoring record id %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred."
        )


# ---------------------------------------------------------------------------
# DELETE /api/records/bulk — bulk soft delete (Administrator only)
# IMPORTANT: This route MUST be registered before DELETE /api/records/{record_id}
# so FastAPI does not interpret "bulk" as a record_id path parameter.
# ---------------------------------------------------------------------------

@router.delete("/api/records/bulk", status_code=status.HTTP_200_OK)
async def bulk_delete_records(
    body: BulkDeleteRequest,
    current_user: dict = Depends(_admin_only),
):
    """Bulk soft-delete a list of records. Administrator only.

    Accepts a JSON body: { "record_ids": [1, 4, 7, ...] }
    Skips IDs that do not exist or are already soft-deleted — does not raise
    errors for them. Returns a summary: { "deleted": n, "skipped": n }.
    Validation (non-empty, all positive, max 100) is enforced by BulkDeleteRequest.
    """
    try:
        username = current_user["sub"]
        now_iso  = _now_utc_str()
        deleted  = 0
        skipped  = 0

        for record_id in body.record_ids:
            row = fetch_one(
                "SELECT id FROM maintenance_records WHERE id = ? AND deleted_date IS NULL",
                (record_id,),
            )
            if not row:
                # Record does not exist or is already soft-deleted — skip silently
                skipped += 1
                continue

            execute(
                "UPDATE maintenance_records SET deleted_by = ?, deleted_date = ? WHERE id = ?",
                (username, now_iso, record_id),
            )
            deleted += 1

        return {"deleted": deleted, "skipped": skipped}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error in bulk delete operation.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred during bulk delete.",
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
# GET /api/records/{id}/attachments — list all attachments for a record
# ---------------------------------------------------------------------------

@router.get("/api/records/{record_id}/attachments")
async def list_record_attachments(
    record_id: int,
    current_user: dict = Depends(get_current_user),
) -> list[AttachmentOut]:
    """Return all attachment rows for a record. All roles. Empty list if none."""
    try:
        record_row = fetch_one(
            "SELECT id FROM maintenance_records WHERE id = ? AND deleted_date IS NULL",
            (record_id,),
        )
        if not record_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Record {record_id} not found.",
            )

        rows = fetch_all(
            "SELECT * FROM record_attachments WHERE record_id = ? ORDER BY id ASC",
            (record_id,),
        )
        return [
            AttachmentOut(
                id=r["id"],
                record_id=r["record_id"],
                original_filename=r["original_filename"],
                file_size_bytes=r["file_size_bytes"],
                uploaded_by=r["uploaded_by"],
                uploaded_date=r["uploaded_date"],
            )
            for r in rows
        ]

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error listing attachments for record %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving attachments.",
        )


# ---------------------------------------------------------------------------
# GET /api/attachments/{attachment_id} — stream a specific attachment file
# ---------------------------------------------------------------------------

@router.get("/api/attachments/{attachment_id}")
async def download_attachment(
    attachment_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Stream the file for a specific record_attachments row. All roles.

    Keyed by attachment_id (record_attachments.id), not by record_id.
    Returns 404 if the attachment row does not exist, if the parent record is
    soft-deleted, or if the physical file is missing from disk.
    """
    try:
        row = fetch_one(
            """
            SELECT ra.*, mr.deleted_date AS record_deleted_date
            FROM record_attachments ra
            JOIN maintenance_records mr ON mr.id = ra.record_id
            WHERE ra.id = ?
            """,
            (attachment_id,),
        )
        if not row or row["record_deleted_date"] is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment not found.",
            )

        file_path = row["file_path"]
        if not os.path.isfile(file_path):
            logger.error(
                "Attachment file missing on disk: attachment_id=%s, path=%s",
                attachment_id,
                file_path,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment file could not be found on the server.",
            )

        return FileResponse(
            path=file_path,
            filename=row["original_filename"] or os.path.basename(file_path),
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error serving attachment id %s.", attachment_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving the attachment.",
        )


# ---------------------------------------------------------------------------
# DELETE /api/attachments/{attachment_id} — delete a specific attachment
# ---------------------------------------------------------------------------

@router.delete("/api/attachments/{attachment_id}", status_code=status.HTTP_200_OK)
async def delete_attachment(
    attachment_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Delete a specific attachment by its own ID.

    - Engineers may only delete attachments from records they created.
    - Administrators may delete any attachment.
    - Ownership is verified via the parent record's created_by field (two-step join).
    - Physical file deletion is non-fatal if the file is already missing from disk.
    - Updates updated_by / updated_date on the parent record (this is a record edit).
    """
    try:
        role = current_user.get("role")
        username = current_user["sub"]

        if role not in (ROLES["ADMIN"], ROLES["ENGINEER"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to delete attachments.",
            )

        # Fetch attachment + parent record ownership in one join
        row = fetch_one(
            """
            SELECT ra.*,
                   mr.created_by  AS record_created_by,
                   mr.deleted_date AS record_deleted_date
            FROM record_attachments ra
            JOIN maintenance_records mr ON mr.id = ra.record_id
            WHERE ra.id = ?
            """,
            (attachment_id,),
        )
        if not row or row["record_deleted_date"] is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment not found.",
            )

        # Engineers may only delete attachments from records they own
        if role == ROLES["ENGINEER"] and row["record_created_by"] != username:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Engineers may only delete attachments from records they created.",
            )

        # Attempt physical file deletion — non-fatal if already missing
        file_path = row["file_path"]
        try:
            if os.path.isfile(file_path):
                os.remove(file_path)
            else:
                logger.warning(
                    "Attachment file already missing on disk: attachment_id=%s, path=%s",
                    attachment_id,
                    file_path,
                )
        except OSError:
            logger.warning(
                "Could not delete attachment file: attachment_id=%s, path=%s",
                attachment_id,
                file_path,
                exc_info=True,
            )

        # Delete the record_attachments row
        execute("DELETE FROM record_attachments WHERE id = ?", (attachment_id,))

        # Update parent record audit columns — removing an attachment is a record edit
        now_iso = _now_utc_str()
        execute(
            "UPDATE maintenance_records SET updated_by = ?, updated_date = ? WHERE id = ?",
            (username, now_iso, row["record_id"]),
        )

        return {"detail": f"Attachment {attachment_id} deleted successfully."}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error deleting attachment id %s.", attachment_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while deleting the attachment.",
        )
