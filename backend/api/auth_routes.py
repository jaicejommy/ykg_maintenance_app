# backend/api/auth_routes.py
# Authentication routes: POST /api/auth/login, PUT /api/auth/change-password

import logging

from fastapi import APIRouter, Depends, Form, HTTPException, status
from pydantic import BaseModel

from backend.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from backend.constants import TOKEN_TYPE
from backend.database import execute, fetch_one

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
async def login(
    username: str = Form(...),
    password: str = Form(...),
):
    """Authenticate a user and return a JWT access token.

    Returns HTTP 401 with a generic message on any failure — never specifies
    whether the username or the password was incorrect.
    """
    try:
        row = fetch_one(
            "SELECT hashed_password, role, is_active FROM users WHERE username = ?",
            (username,),
        )

        auth_failed = (
            row is None
            or not verify_password(password, row["hashed_password"])
            or not row["is_active"]
        )

        if auth_failed:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials. Please try again.",
            )

        token_data = {"sub": username, "role": row["role"]}
        access_token = create_access_token(token_data)

        return {
            "access_token": access_token,
            "token_type": TOKEN_TYPE,
            "role": row["role"],
            "username": username,
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error during login for user '%s'.", username)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again later.",
        )


class ChangePasswordRequest(BaseModel):
    """Payload schema for PUT /api/auth/change-password."""

    current_password: str
    new_password: str
    confirm_new_password: str


@router.put("/change-password", status_code=status.HTTP_200_OK)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: dict = Depends(get_current_user),
):
    """Allow any authenticated user to change their own password.

    Identity is derived exclusively from the JWT 'sub' claim — the request body
    must not and does not accept a user_id. This prevents one user from changing
    another user's password through this endpoint.

    Validation order (all server-side):
      1. Verify current_password against the stored bcrypt hash.
      2. Confirm new_password == confirm_new_password.
      3. Enforce minimum 8-character length on new_password.
      4. Reject if new_password is identical to current_password.
    """
    try:
        username = current_user["sub"]

        row = fetch_one(
            "SELECT hashed_password FROM users WHERE username = ?",
            (username,),
        )
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found.",
            )

        # 1. Verify the provided current password against the stored hash.
        if not verify_password(payload.current_password, row["hashed_password"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect.",
            )

        # 2. Confirm the two new-password fields match.
        if payload.new_password != payload.confirm_new_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New passwords do not match.",
            )

        # 3. Enforce minimum length.
        if len(payload.new_password) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be at least 8 characters.",
            )

        # 4. Reject if the new password is identical to the current one.
        if verify_password(payload.new_password, row["hashed_password"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be different from the current password.",
            )

        # Hash and persist.
        new_hashed = hash_password(payload.new_password)
        execute(
            "UPDATE users SET hashed_password = ? WHERE username = ?",
            (new_hashed, username),
        )

        return {"detail": "Password changed successfully."}

    except HTTPException:
        raise
    except Exception:
        logger.exception(
            "Unexpected error during password change for user '%s'.", current_user.get("sub")
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An unexpected error occurred. Please try again later.",
        )
