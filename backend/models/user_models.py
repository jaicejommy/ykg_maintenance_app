# backend/models/user_models.py
# Pydantic schemas for user-related API payloads and responses.

from typing import Optional

from pydantic import BaseModel, field_validator

from backend.constants import MAX_USERNAME_LENGTH, VALID_ROLES


class UserCreate(BaseModel):
    """Payload schema for POST /api/users — create a new user."""

    username: str
    password: str
    role: str

    @field_validator("username")
    @classmethod
    def username_not_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Username must not be blank.")
        if len(stripped) > MAX_USERNAME_LENGTH:
            raise ValueError(
                f"Username must be at most {MAX_USERNAME_LENGTH} characters."
            )
        return stripped

    @field_validator("password")
    @classmethod
    def password_not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Password must not be blank.")
        return value

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, value: str) -> str:
        if value not in VALID_ROLES:
            raise ValueError(
                f"Role must be one of: {', '.join(sorted(VALID_ROLES))}."
            )
        return value


class UserUpdate(BaseModel):
    """Payload schema for PUT /api/users/{id} — update role, status, or password."""

    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and value not in VALID_ROLES:
            raise ValueError(
                f"Role must be one of: {', '.join(sorted(VALID_ROLES))}."
            )
        return value


class UserOut(BaseModel):
    """Safe user representation returned to the client — never includes hashed_password."""

    id: int
    username: str
    role: str
    is_active: bool
