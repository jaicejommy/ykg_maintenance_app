# backend/api/user_routes.py
# User management routes: GET /api/users, POST /api/users, PUT /api/users/{id}
# Access restricted to Administrators only.

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status

from backend.auth import hash_password, require_role, get_current_user
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


@router.get("/active", status_code=status.HTTP_200_OK)
async def list_active_usernames(
    _current_user: dict = Depends(get_current_user),
) -> List[str]:
    """Return all active usernames. Any authenticated user can access this."""
    try:
        rows = fetch_all("SELECT username FROM users WHERE is_active = 1", ())
        return [row["username"] for row in rows]
    except Exception:
        logger.exception("Error listing active usernames.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred while retrieving active users.",
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
    current_user: dict = Depends(_admin_only),
) -> UserOut:
    """Update a user's role, active status, or password. Administrators only.

    Critical safeguards:
    - An Administrator may not deactivate their own account.
    - new_password (preferred) or password (legacy) triggers a bcrypt hash update.
    - The SET clause is built dynamically — omitting password fields does not
      overwrite the stored hash with NULL.
    - The response schema (UserOut) never includes hashed_password.

    Password field precedence: new_password takes priority over password if both
    are provided. This supports the frontend Admin temporary-reset flow which
    sends { new_password: "..." }.
    """
    try:
        row = fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with id {user_id} not found.",
            )

        # Prevent an Administrator from deactivating their own account.
        current_username = current_user["sub"]
        if payload.is_active is False and row["username"] == current_username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot deactivate your own account.",
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

        # new_password takes precedence over legacy password field.
        # Only one should be sent per request in practice.
        raw_new_password = payload.new_password or payload.password
        if raw_new_password:
            if len(raw_new_password) < 8:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="New password must be at least 8 characters.",
                )
            fields.append("hashed_password = ?")
            params.append(hash_password(raw_new_password))

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
