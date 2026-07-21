# backend/models/equipment_models.py
# Pydantic schemas for equipment API responses.

from typing import Optional
from pydantic import BaseModel, model_validator


class EquipmentCreate(BaseModel):
    enterprise_name: str
    site:            str
    area:            Optional[str] = ""
    work_center:     Optional[str] = ""
    work_unit:       Optional[str] = ""
    equipment_id:    str

    @model_validator(mode="after")
    def validate_fields(self):
        # All fields must not exceed 200 chars
        all_fields = {
            "enterprise_name": self.enterprise_name,
            "site":            self.site,
            "area":            self.area,
            "work_center":     self.work_center,
            "work_unit":       self.work_unit,
            "equipment_id":    self.equipment_id,
        }
        for name, value in all_fields.items():
            if value and len(value.strip()) > 200:
                raise ValueError(f"{name} must not exceed 200 characters.")
                
        # Only specific fields are required
        required_fields = {
            "enterprise_name": self.enterprise_name,
            "site":            self.site,
            "equipment_id":    self.equipment_id,
        }
        for name, value in required_fields.items():
            if not value or not value.strip():
                raise ValueError(f"{name} is required and cannot be blank.")
                
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
