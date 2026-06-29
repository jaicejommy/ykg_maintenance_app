# backend/api/user_routes.py
# User management routes: GET /api/users, POST /api/users, PUT /api/users/{id}
# Access restricted to Administrators only.

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import hash_password, require_role
from backend.constants import ROLES
from backend.database import execute, fetch_all, fetch_one
from backend.models.user_models import UserCreate, UserOut, UserUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/users", tags=["users"])

_admin_only = require_role(ROLES["ADMIN"])


def _row_to_user_out(row) -> UserOut:
    """Convert a sqlite3.Row to a UserOut schema instance."""
    return UserOut(
        id=row["id"],
        username=row["username"],
        role=row["role"],
        is_active=bool(row["is_active"]),
    )


@router.get("", status_code=status.HTTP_200_OK)
async def list_users(
    _current_user: dict = Depends(_admin_only),
) -> List[UserOut]:
    """Return all user accounts. Only Administrators may call this endpoint.
    Returns an empty list if no users exist."""
    try:
        rows = fetch_all("SELECT id, username, role, is_active FROM users", ())
        return [_row_to_user_out(row) for row in rows]
    except Exception:
        logger.exception("Error listing users.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving users.",
        )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    _current_user: dict = Depends(_admin_only),
) -> UserOut:
    """Create a new user account. Only Administrators may call this endpoint."""
    try:
        existing = fetch_one(
            "SELECT id FROM users WHERE username = ?", (payload.username,)
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Username '{payload.username}' is already taken.",
            )

        hashed = hash_password(payload.password)
        new_id = execute(
            "INSERT INTO users (username, hashed_password, role) VALUES (?, ?, ?)",
            (payload.username, hashed, payload.role),
        )

        new_row = fetch_one("SELECT * FROM users WHERE id = ?", (new_id,))
        return _row_to_user_out(new_row)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error creating user '%s'.", payload.username)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while creating the user.",
        )


@router.put("/{user_id}", status_code=status.HTTP_200_OK)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    _current_user: dict = Depends(_admin_only),
) -> UserOut:
    """Update a user's role, active status, or password. Administrators only."""
    try:
        row = fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with id {user_id} not found.",
            )

        # Build the update dynamically from only the provided fields
        fields: list[str] = []
        params: list = []

        if payload.role is not None:
            fields.append("role = ?")
            params.append(payload.role)

        if payload.is_active is not None:
            fields.append("is_active = ?")
            params.append(1 if payload.is_active else 0)

        if payload.password is not None and payload.password:
            fields.append("hashed_password = ?")
            params.append(hash_password(payload.password))

        if not fields:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No updatable fields were provided.",
            )

        params.append(user_id)
        execute(
            f"UPDATE users SET {', '.join(fields)} WHERE id = ?",  # noqa: S608
            tuple(params),
        )

        updated_row = fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
        return _row_to_user_out(updated_row)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error updating user id %s.", user_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while updating the user.",
        )
