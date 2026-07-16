# backend/models/equipment_models.py
# Pydantic schemas for equipment API responses.

from typing import Optional
from pydantic import BaseModel, model_validator


class EquipmentCreate(BaseModel):
    enterprise_name: str
    site:            str
    area:            str
    work_center:     str
    work_unit:       str
    equipment_id:    str

    @model_validator(mode="after")
    def validate_fields(self):
        fields = {
            "enterprise_name": self.enterprise_name,
            "site":            self.site,
            "area":            self.area,
            "work_center":     self.work_center,
            "work_unit":       self.work_unit,
            "equipment_id":    self.equipment_id,
        }
        for name, value in fields.items():
            if not value or not value.strip():
                raise ValueError(f"{name} is required and cannot be blank.")
            if len(value.strip()) > 200:
                raise ValueError(f"{name} must not exceed 200 characters.")
        return self


class EquipmentUpdate(BaseModel):
    is_active: Optional[bool] = None


class EquipmentOut(BaseModel):
    id:              int
    enterprise_name: str
    site:            str
    area:            str
    work_center:     str
    work_unit:       str
    equipment_id:    str
    full_path:       str
    is_active:       int
    created_by:      str
    created_date:    str
