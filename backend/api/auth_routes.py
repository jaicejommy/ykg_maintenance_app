# backend/api/auth_routes.py
# Authentication route: POST /api/auth/login

import logging

from fastapi import APIRouter, Form, HTTPException, status

from backend.auth import create_access_token, verify_password
from backend.constants import TOKEN_TYPE
from backend.database import fetch_one

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
