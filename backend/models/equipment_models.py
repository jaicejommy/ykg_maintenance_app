# backend/models/equipment_models.py
# Pydantic schemas for equipment API responses.

from pydantic import BaseModel


class EquipmentOut(BaseModel):
    """Equipment row representation returned to the client."""

    id: int
    code: str
    name: str
    category: str
    is_active: int
