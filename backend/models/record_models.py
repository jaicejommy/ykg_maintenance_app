# backend/models/record_models.py
# Pydantic schemas for maintenance record API payloads and responses.

from typing import Optional

from pydantic import BaseModel, field_validator

from backend.constants import (
    MAINTENANCE_TYPES,
    MAX_EQUIPMENT_ID_LENGTH,
    MAX_REMARKS_LENGTH,
    MAX_RESPONSIBLE_PERSON_LENGTH,
    MAX_TEXT_FIELD_LENGTH,
)


class RecordCreate(BaseModel):
    """Fields required when creating a new maintenance record via form data.

    Note: This model is used for validation of individual string fields received
    from multipart/form-data. The file attachment is handled separately.
    """

    maintenance_type: str
    equipment_id: str
    date_time: str
    responsible_person: str
    operating_conditions: Optional[str] = None
    inventory_consumables: Optional[str] = None
    remarks: Optional[str] = None

    @field_validator("maintenance_type")
    @classmethod
    def maintenance_type_must_be_valid(cls, value: str) -> str:
        if value not in MAINTENANCE_TYPES:
            raise ValueError(
                f"maintenance_type must be one of: {', '.join(MAINTENANCE_TYPES)}."
            )
        return value

    @field_validator("equipment_id")
    @classmethod
    def equipment_id_not_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("equipment_id must not be blank.")
        if len(stripped) > MAX_EQUIPMENT_ID_LENGTH:
            raise ValueError(
                f"equipment_id must be at most {MAX_EQUIPMENT_ID_LENGTH} characters."
            )
        return stripped

    @field_validator("date_time")
    @classmethod
    def date_time_not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("date_time must not be blank.")
        return value.strip()

    @field_validator("responsible_person")
    @classmethod
    def responsible_person_not_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("responsible_person must not be blank.")
        if len(stripped) > MAX_RESPONSIBLE_PERSON_LENGTH:
            raise ValueError(
                f"responsible_person must be at most {MAX_RESPONSIBLE_PERSON_LENGTH} characters."
            )
        return stripped

    @field_validator("operating_conditions")
    @classmethod
    def operating_conditions_max_length(cls, value: Optional[str]) -> Optional[str]:
        if value and len(value) > MAX_TEXT_FIELD_LENGTH:
            raise ValueError(
                f"operating_conditions must be at most {MAX_TEXT_FIELD_LENGTH} characters."
            )
        return value

    @field_validator("inventory_consumables")
    @classmethod
    def inventory_consumables_max_length(cls, value: Optional[str]) -> Optional[str]:
        if value and len(value) > MAX_TEXT_FIELD_LENGTH:
            raise ValueError(
                f"inventory_consumables must be at most {MAX_TEXT_FIELD_LENGTH} characters."
            )
        return value

    @field_validator("remarks")
    @classmethod
    def remarks_max_length(cls, value: Optional[str]) -> Optional[str]:
        if value and len(value) > MAX_REMARKS_LENGTH:
            raise ValueError(
                f"remarks must be at most {MAX_REMARKS_LENGTH} characters."
            )
        return value


class RecordUpdate(BaseModel):
    """Fields that may be updated on an existing maintenance record."""

    maintenance_type: Optional[str] = None
    equipment_id: Optional[str] = None
    date_time: Optional[str] = None
    responsible_person: Optional[str] = None
    operating_conditions: Optional[str] = None
    inventory_consumables: Optional[str] = None
    remarks: Optional[str] = None

    @field_validator("maintenance_type")
    @classmethod
    def maintenance_type_must_be_valid(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in MAINTENANCE_TYPES:
            raise ValueError(
                f"maintenance_type must be one of: {', '.join(MAINTENANCE_TYPES)}."
            )
        return value

    @field_validator("equipment_id")
    @classmethod
    def equipment_id_not_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            stripped = value.strip()
            if not stripped:
                raise ValueError("equipment_id must not be blank.")
            if len(stripped) > MAX_EQUIPMENT_ID_LENGTH:
                raise ValueError(
                    f"equipment_id must be at most {MAX_EQUIPMENT_ID_LENGTH} characters."
                )
            return stripped
        return value

    @field_validator("responsible_person")
    @classmethod
    def responsible_person_not_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is not None:
            stripped = value.strip()
            if not stripped:
                raise ValueError("responsible_person must not be blank.")
            if len(stripped) > MAX_RESPONSIBLE_PERSON_LENGTH:
                raise ValueError(
                    f"responsible_person must be at most {MAX_RESPONSIBLE_PERSON_LENGTH} characters."
                )
            return stripped
        return value

    @field_validator("remarks")
    @classmethod
    def remarks_max_length(cls, value: Optional[str]) -> Optional[str]:
        if value and len(value) > MAX_REMARKS_LENGTH:
            raise ValueError(
                f"remarks must be at most {MAX_REMARKS_LENGTH} characters."
            )
        return value


class RecordOut(BaseModel):
    """Full maintenance record representation returned to the client."""

    id: int
    maintenance_type: str
    operating_conditions: Optional[str]
    inventory_consumables: Optional[str]
    equipment_id: str
    date_time: str
    responsible_person: str
    remarks: Optional[str]
    attachment_path: Optional[str]
    attachment_original_name: Optional[str]
    created_by: str
    created_date: str
    updated_by: Optional[str]
    updated_date: Optional[str]
