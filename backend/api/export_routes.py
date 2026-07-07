# backend/api/export_routes.py
# PDF export route for a single maintenance record.
# All PDF generation happens in memory — no files are written to disk.
# reportlab is imported only inside _build_pdf(), not at module level.

import json
import logging
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from backend.auth import get_current_user
from backend.database import fetch_all, fetch_one

logger = logging.getLogger(__name__)

router = APIRouter(tags=["export"])


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _fmt(value) -> str:
    """Return a printable string for any field value.

    Returns an em-dash for None, empty, or whitespace-only values.
    Must be called for every field value rendered in the PDF — never use
    inline ``or "—"`` patterns in _build_pdf().
    """
    if value is None or str(value).strip() == "":
        return "\u2014"
    return str(value).strip()


def _get_export_data(record_id: int) -> dict | None:
    """Fetch all data needed for the PDF export in one place.

    Returns a dict with keys: record, attachments, csv_headers, csv_rows.
    Returns None if the record does not exist or is soft-deleted.
    csv_headers / csv_rows are None when no CSV data exists — callers must
    check for None before rendering the CSV section.
    """
    # 1. Fetch the maintenance record
    record_row = fetch_one(
        "SELECT * FROM maintenance_records WHERE id = ? AND deleted_date IS NULL",
        (record_id,),
    )
    if record_row is None:
        return None

    # 2. Fetch attachments
    attachment_rows = fetch_all(
        "SELECT * FROM record_attachments WHERE record_id = ?",
        (record_id,),
    )

    # 3. Fetch CSV row — None is valid (no CSV uploaded)
    csv_row = fetch_one(
        "SELECT * FROM record_csv_data WHERE record_id = ?",
        (record_id,),
    )

    # 4. Parse CSV JSON blobs
    csv_headers = None
    csv_rows = None
    if csv_row is not None:
        try:
            csv_headers = json.loads(csv_row["headers"])
            csv_rows = json.loads(csv_row["rows"])
        except (TypeError, json.JSONDecodeError):
            csv_headers = None
            csv_rows = None

    # 5. Return assembled payload
    return {
        "record": dict(record_row),
        "attachments": [dict(a) for a in attachment_rows],
        "csv_headers": csv_headers,   # list[str] or None
        "csv_rows": csv_rows,         # list[list[str]] or None
    }


def _build_pdf(data: dict, exported_by: str) -> bytes:
    """Build the PDF document in memory and return its raw bytes.

    All reportlab imports live inside this function so the module can be
    imported even before reportlab is installed (e.g. during initial setup).
    The route handler calls this function and gets back bytes — no reportlab
    logic leaks into the route layer.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.platypus import (
        HRFlowable,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    record = data["record"]
    attachments = data["attachments"]
    csv_headers = data["csv_headers"]
    csv_rows = data["csv_rows"]

    buffer = BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=40,
        bottomMargin=40,
        leftMargin=50,
        rightMargin=50,
        title=f"Record {record.get('id')} Export",
        author=exported_by,
    )

    # -- Color tokens ---------------------------------------------------------
    C_DARK   = colors.HexColor("#1C1C1E")
    C_GREY   = colors.HexColor("#6B6B72")
    C_MUTED  = colors.HexColor("#A0A0A8")
    C_BORDER = colors.HexColor("#D1D1D6")
    C_ALTROW = colors.HexColor("#F9F9FA")
    C_HEADER = colors.HexColor("#2C2C2E")
    C_WHITE  = colors.white

    # -- Styles ---------------------------------------------------------------
    base = getSampleStyleSheet()["Normal"]

    def make_style(name, **kwargs):
        return ParagraphStyle(name, parent=base, **kwargs)

    title_style = make_style(
        "T",
        fontSize=15,
        fontName="Helvetica-Bold",
        textColor=C_DARK,
        spaceAfter=2,
    )
    subtitle_style = make_style(
        "S",
        fontSize=11,
        fontName="Helvetica-Bold",
        textColor=C_DARK,
        spaceAfter=2,
    )
    meta_style = make_style(
        "M",
        fontSize=7,
        fontName="Helvetica",
        textColor=C_MUTED,
        spaceAfter=8,
    )
    section_style = make_style(
        "H",
        fontSize=8,
        fontName="Helvetica-Bold",
        textColor=C_GREY,
        spaceBefore=14,
        spaceAfter=6,
    )
    note_style = make_style(
        "N",
        fontSize=7,
        fontName="Helvetica-Oblique",
        textColor=C_MUTED,
        spaceAfter=4,
    )

    # -- Page usable width ----------------------------------------------------
    PAGE_W = A4[0] - 100  # 595 - 100 = 495pt usable

    # -- Reusable table style builder -----------------------------------------
    def base_table_style(has_header=True):
        cmds = [
            ("FONTSIZE",      (0, 0), (-1, -1), 8.5),
            ("GRID",          (0, 0), (-1, -1), 0.5, C_BORDER),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("WORDWRAP",      (0, 0), (-1, -1), "LTR"),
        ]
        if has_header:
            cmds += [
                ("BACKGROUND",    (0, 0), (-1, 0), C_HEADER),
                ("TEXTCOLOR",     (0, 0), (-1, 0), C_WHITE),
                ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ROWBACKGROUNDS",(0, 1), (-1, -1), [C_WHITE, C_ALTROW]),
                ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
            ]
        return TableStyle(cmds)

    # -- Content assembly ------------------------------------------------------
    content = []

    # Block 1 — Document header
    content.append(Paragraph("Maintenance Record", title_style))
    content.append(Paragraph(_fmt(record.get("equipment_id")), subtitle_style))
    content.append(
        Paragraph(
            f"Record ID: {record.get('id')}  |  "
            f"Exported by: {exported_by}  |  "
            f"{datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
            meta_style,
        )
    )
    content.append(
        HRFlowable(width="100%", thickness=0.75, color=C_BORDER, spaceAfter=10)
    )

    # Block 2 — Record Details (label-value table, no header row)
    content.append(Paragraph("RECORD DETAILS", section_style))

    detail_data = [
        ["Maintenance Type",      _fmt(record.get("maintenance_type"))],
        ["Equipment ID",          _fmt(record.get("equipment_id"))],
        ["Created Time",          _fmt(record.get("created_time"))],
        ["Planned Start",         _fmt(record.get("planned_start"))],
        ["Planned End",           _fmt(record.get("planned_end"))],
        ["Last Updated",          _fmt(record.get("last_updated_time"))],
        ["Responsible Person",    _fmt(record.get("responsible_person"))],
        ["Operating Conditions",  _fmt(record.get("operating_conditions"))],
        ["Inventory/Consumables", _fmt(record.get("inventory_consumables"))],
        ["Remarks",               _fmt(record.get("remarks"))],
        ["Created By",            _fmt(record.get("created_by"))],
        ["Created Date",          _fmt(record.get("created_date"))],
        ["Updated By",            _fmt(record.get("updated_by"))],
        ["Updated Date",          _fmt(record.get("updated_date"))],
    ]

    detail_style = TableStyle(
        [
            ("FONTNAME",       (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME",       (1, 0), (1, -1), "Helvetica"),
            ("FONTSIZE",       (0, 0), (-1, -1), 8.5),
            ("TEXTCOLOR",      (0, 0), (0, -1), C_GREY),
            ("TEXTCOLOR",      (1, 0), (1, -1), C_DARK),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [C_WHITE, C_ALTROW]),
            ("GRID",           (0, 0), (-1, -1), 0.5, C_BORDER),
            ("TOPPADDING",     (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",  (0, 0), (-1, -1), 5),
            ("LEFTPADDING",    (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",   (0, 0), (-1, -1), 8),
            ("VALIGN",         (0, 0), (-1, -1), "TOP"),
            ("WORDWRAP",       (1, 0), (1, -1), "LTR"),
        ]
    )
    detail_table = Table(detail_data, colWidths=[140, PAGE_W - 140])
    detail_table.setStyle(detail_style)
    content.append(detail_table)

    # Block 3 — Attachments (only if any exist)
    if attachments:
        content.append(Paragraph("ATTACHMENTS", section_style))
        att_data = [["Filename", "Uploaded By", "Uploaded Date"]]
        for att in attachments:
            att_data.append(
                [
                    _fmt(att.get("original_filename")),
                    _fmt(att.get("uploaded_by")),
                    _fmt(att.get("uploaded_date")),
                ]
            )
        att_table = Table(
            att_data,
            colWidths=[PAGE_W * 0.5, PAGE_W * 0.25, PAGE_W * 0.25],
        )
        att_table.setStyle(base_table_style(has_header=True))
        content.append(att_table)

    # Block 4 — CSV Data grid (only if CSV data exists)
    # Both csv_headers AND csv_rows must be non-None to render this section.
    # An empty section heading is never added when either is None.
    if csv_headers is not None and csv_rows is not None:
        content.append(Paragraph("ATTACHED CSV DATA", section_style))

        rows_to_render = csv_rows[:500]
        if len(csv_rows) > 500:
            content.append(
                Paragraph(
                    f"Note: CSV data truncated to 500 rows for export "
                    f"(original: {len(csv_rows)} rows).",
                    note_style,
                )
            )

        csv_table_data = [csv_headers] + [
            [_fmt(cell) for cell in row] for row in rows_to_render
        ]

        n_cols = max(len(csv_headers), 1)
        col_w  = min(PAGE_W / n_cols, 110)  # cap each column at 110pt

        csv_style = TableStyle(
            [
                ("BACKGROUND",     (0, 0), (-1, 0), C_HEADER),
                ("TEXTCOLOR",      (0, 0), (-1, 0), C_WHITE),
                ("FONTNAME",       (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME",       (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE",       (0, 0), (-1, -1), 7),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [C_WHITE, C_ALTROW]),
                ("GRID",           (0, 0), (-1, -1), 0.4, C_BORDER),
                ("TOPPADDING",     (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING",  (0, 0), (-1, -1), 4),
                ("LEFTPADDING",    (0, 0), (-1, -1), 5),
                ("RIGHTPADDING",   (0, 0), (-1, -1), 5),
                ("VALIGN",         (0, 0), (-1, -1), "TOP"),
                ("WORDWRAP",       (0, 1), (-1, -1), "LTR"),
            ]
        )
        csv_table = Table(
            csv_table_data,
            colWidths=[col_w] * n_cols,
            repeatRows=1,  # repeat header row on every page for long datasets
        )
        csv_table.setStyle(csv_style)
        content.append(csv_table)

    # -- Build ----------------------------------------------------------------
    doc.build(content)
    buffer.seek(0)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Route — GET /{record_id}/pdf
# (registered under /api/export by main.py)
# ---------------------------------------------------------------------------


@router.get("/{record_id}/pdf")
async def export_record_pdf(
    record_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Export a single maintenance record as a downloadable PDF.

    Auth: all authenticated roles (Viewer, Engineer/Operator, Administrator).
    Returns 404 if the record does not exist or has been soft-deleted.
    Returns 500 (generic message, traceback logged) on any unexpected error.
    All PDF generation happens in memory — no files are written to disk.
    """
    try:
        data = _get_export_data(record_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Record not found.")

        pdf_bytes = _build_pdf(data, current_user["sub"])
        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="record_{record_id}_export.pdf"'
                )
            },
        )
    except HTTPException:
        raise
    except Exception:
        logging.exception(
            "Unexpected error in GET /api/export/%s/pdf", record_id
        )
        raise HTTPException(
            status_code=500, detail="PDF export failed. Please try again."
        )
