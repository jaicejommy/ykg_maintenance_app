# backend/models/csv_models.py
# Pydantic schemas for CSV data API payloads and responses.

from pydantic import BaseModel


class CsvSaveRequest(BaseModel):
    """JSON body accepted by PUT /api/csv/{record_id}."""
    rows: list[list[str]]


class CsvResponse(BaseModel):
    """Full CSV dataset representation returned to the client."""
    rows: list[list[str]]
    row_count: int
    col_count: int
