# backend/api/csv_routes.py
# CSV upload, edit, and download routes for maintenance records.
# All parsing and reconstruction happen in memory — no CSV files are written to disk.

import csv
import io
import json
import logging
import os
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse

from backend.auth import get_current_user, require_role
from backend.constants import ROLES
from backend.database import execute, fetch_one
from backend.models.csv_models import CsvSaveRequest, CsvResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["csv"])

_engineer_or_admin = require_role(ROLES["ADMIN"], ROLES["ENGINEER"])

# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------
MAX_CSV_COLUMNS = 50
MAX_CSV_ROWS    = 5000
MAX_CELL_LENGTH = 1000

CSV_ALLOWED_MIME_TYPES = {"text/csv", "application/vnd.ms-excel"}

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


def _strip_html(value: str) -> str:
    """Remove any HTML tags from a cell value before storing."""
    return re.sub(r'<[^>]+>', '', value)


def _sanitize_cell(value: str) -> str:
    """Strip whitespace from a single cell value. Do not strip angle brackets."""
    return value.strip()


def _get_active_record(record_id: int):
    """Fetch an active (non-deleted) maintenance record row, or raise 404."""
    row = fetch_one(
        "SELECT * FROM maintenance_records WHERE id = ? AND deleted_date IS NULL",
        (record_id,),
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Record {record_id} not found.",
        )
    return row


# ---------------------------------------------------------------------------
# GET /api/csv/{record_id} — retrieve CSV data
# ---------------------------------------------------------------------------

@router.get("/api/csv/{record_id}")
async def get_csv_data(
    record_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Return the CSV data for a record as {headers, rows}.
    Returns 404 if no CSV data exists for this record.
    """
    try:
        _get_active_record(record_id)

        csv_row = fetch_one(
            "SELECT headers, rows FROM record_csv_data WHERE record_id = ?",
            (record_id,),
        )
        if not csv_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No CSV data found for this record.",
            )

        headers = json.loads(csv_row["headers"])
        rows    = json.loads(csv_row["rows"])
        return {"headers": headers, "rows": rows}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error retrieving CSV data for record %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving CSV data.",
        )


# ---------------------------------------------------------------------------
# POST /api/csv/{record_id} — upload and parse a CSV file
# ---------------------------------------------------------------------------

@router.post("/api/csv/{record_id}", status_code=status.HTTP_201_CREATED)
async def upload_csv(
    record_id: int,
    csv_file: UploadFile = File(...),
    current_user: dict = Depends(_engineer_or_admin),
):
    """Upload and parse a CSV file for a maintenance record.
    Replaces any existing CSV data for this record.
    """
    try:
        _get_active_record(record_id)

        # --- Extension validation ---
        filename = csv_file.filename or ""
        ext = os.path.splitext(filename)[1].lower()
        if ext != ".csv":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File must have a .csv extension.",
            )

        # --- MIME type validation ---
        if csv_file.content_type not in CSV_ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Invalid MIME type '{csv_file.content_type}'. "
                    "Accepted: text/csv, application/vnd.ms-excel."
                ),
            )

        # --- Read file bytes ---
        contents = await csv_file.read()

        # --- Size validation ---
        max_bytes = _get_max_upload_bytes()
        if len(contents) > max_bytes:
            max_mb = max_bytes / (1024 * 1024)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File exceeds the maximum allowed size of {max_mb:.0f} MB.",
            )

        # --- Non-empty validation ---
        decoded = contents.decode("utf-8-sig", errors="replace")
        if not decoded.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The uploaded CSV file is empty.",
            )

        # --- Parse CSV ---
        reader = csv.reader(io.StringIO(decoded))
        all_rows = list(reader)

        if len(all_rows) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CSV must contain at least one header row and one data row.",
            )

        # --- Column count limit ---
        for r in all_rows:
            if len(r) > MAX_CSV_COLUMNS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"CSV rows may not exceed {MAX_CSV_COLUMNS} columns.",
                )

        # --- Row count limit ---
        if len(all_rows) > MAX_CSV_ROWS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"CSV may not exceed {MAX_CSV_ROWS} data rows. Found {len(all_rows)}.",
            )

        # --- Sanitize ---
        headers = [] # Obsolete, kept for backwards DB compatibility
        rows    = [[_sanitize_cell(cell) for cell in row] for row in all_rows]

        # --- Persist ---
        username = current_user["sub"]
        now      = _now_utc_str()

        execute(
            """
            INSERT OR REPLACE INTO record_csv_data
                (record_id, headers, rows, uploaded_by, uploaded_date, updated_by, updated_date)
            VALUES (?, ?, ?, ?, ?, NULL, NULL)
            """,
            (record_id, json.dumps(headers), json.dumps(rows), username, now),
        )

        execute(
            """
            UPDATE maintenance_records
            SET last_updated_time = ?,
                updated_by        = ?,
                updated_date      = ?
            WHERE id = ?
            """,
            (now, username, now, record_id),
        )

        return CsvResponse(
            headers=headers,
            rows=rows,
            row_count=len(rows),
            col_count=len(headers),
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error uploading CSV for record %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while uploading the CSV file.",
        )


# ---------------------------------------------------------------------------
# PUT /api/csv/{record_id} — save edited grid data
# ---------------------------------------------------------------------------

@router.put("/api/csv/{record_id}")
async def save_csv_data(
    record_id: int,
    body: CsvSaveRequest,
    current_user: dict = Depends(get_current_user),
):
    """Save edited CSV grid data for a maintenance record.
    Engineers may only edit records they created. Administrators may edit any.
    """
    try:
        role     = current_user.get("role")
        username = current_user["sub"]

        # Only Engineers/Operators and Administrators may save edits
        if role not in (ROLES["ADMIN"], ROLES["ENGINEER"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to edit CSV data.",
            )

        record_row = _get_active_record(record_id)

        # Engineers may only edit records they created
        if role == ROLES["ENGINEER"] and record_row["created_by"] != username:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Engineers may only edit CSV data for records they created.",
            )

        # --- Validate body ---
        headers = body.headers
        rows    = body.rows

        if not headers or not isinstance(headers, list) or not all(isinstance(h, str) for h in headers):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="'headers' must be a non-empty list of strings.",
            )

        if not isinstance(rows, list):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="'rows' must be a list of lists.",
            )

        col_count = len(headers)

        if col_count > MAX_CSV_COLUMNS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"CSV may not exceed {MAX_CSV_COLUMNS} columns.",
            )

        if len(rows) > MAX_CSV_ROWS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"CSV may not exceed {MAX_CSV_ROWS} rows.",
            )

        for i, row in enumerate(rows):
            if not isinstance(row, list):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Row {i} is not a list.",
                )
            for j, cell in enumerate(row):
                if not isinstance(cell, str):
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Cell [{i}][{j}] must be a string.",
                    )
                if len(cell) > MAX_CELL_LENGTH:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=(
                            f"Cell [{i}][{j}] exceeds the maximum length of "
                            f"{MAX_CELL_LENGTH} characters."
                        ),
                    )

        # --- Sanitize ---
        clean_headers = [_sanitize_cell(h) for h in headers]
        clean_rows    = [[_sanitize_cell(cell) for cell in row] for row in rows]

        # --- Persist ---
        now = _now_utc_str()
        execute(
            """
            UPDATE record_csv_data
            SET headers      = ?,
                rows         = ?,
                updated_by   = ?,
                updated_date = ?
            WHERE record_id  = ?
            """,
            (json.dumps(clean_headers), json.dumps(clean_rows), username, now, record_id),
        )

        execute(
            """
            UPDATE maintenance_records
            SET last_updated_time = ?,
                updated_by        = ?,
                updated_date      = ?
            WHERE id = ?
            """,
            (now, username, now, record_id),
        )

        return {"headers": clean_headers, "rows": clean_rows}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error saving CSV data for record %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while saving CSV data.",
        )


# ---------------------------------------------------------------------------
# GET /api/csv/{record_id}/download — reconstruct and stream the CSV
# ---------------------------------------------------------------------------

@router.get("/api/csv/{record_id}/download")
async def download_csv(
    record_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Reconstruct and stream the CSV data as a downloadable file.
    Never writes to disk — all reconstruction happens in memory.
    """
    try:
        _get_active_record(record_id)

        csv_row = fetch_one(
            "SELECT headers, rows FROM record_csv_data WHERE record_id = ?",
            (record_id,),
        )
        if not csv_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No CSV data found for this record.",
            )

        headers = json.loads(csv_row["headers"])
        rows    = json.loads(csv_row["rows"])

        # Reconstruct CSV in memory
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        if headers not in rows:
            writer.writerow(headers)
        writer.writerows(rows)
        buffer.seek(0)

        filename = f"record_{record_id}_data.csv"

        return StreamingResponse(
            iter([buffer.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error streaming CSV download for record %s.", record_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while generating the CSV download.",
        )
