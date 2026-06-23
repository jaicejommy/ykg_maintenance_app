# backend/auth.py
# Password hashing, JWT creation/verification, and FastAPI dependency factories.
# Each function has a single responsibility.

import logging
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from passlib.context import CryptContext

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Bcrypt context
# ---------------------------------------------------------------------------
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ---------------------------------------------------------------------------
# OAuth2 scheme — expects Authorization: Bearer <token>
# ---------------------------------------------------------------------------
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    """Return a bcrypt hash of the plaintext password."""
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if the plaintext password matches the stored bcrypt hash."""
    return _pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _get_secret_key() -> str:
    """Retrieve the JWT secret key from the environment."""
    key = os.getenv("SECRET_KEY")
    if not key:
        raise RuntimeError("SECRET_KEY environment variable is not set.")
    return key


def _get_algorithm() -> str:
    """Retrieve the JWT algorithm from the environment (defaults to HS256)."""
    return os.getenv("ALGORITHM", "HS256")


def _get_token_expiry_minutes() -> int:
    """Retrieve the access token expiry duration in minutes from the environment."""
    try:
        return int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
    except ValueError:
        return 480


def create_access_token(data: dict) -> str:
    """Sign and return a JWT containing *data*, with an expiry claim appended.

    Returns the token as a plain string (PyJWT's jwt.encode() return type).
    """
    payload = data.copy()
    expire = datetime.now(tz=timezone.utc) + timedelta(
        minutes=_get_token_expiry_minutes()
    )
    payload["exp"] = expire
    token: str = jwt.encode(
        payload,
        key=_get_secret_key(),
        algorithm=_get_algorithm(),
    )
    return token


def decode_access_token(token: str) -> dict:
    """Verify and decode a JWT. Raises HTTPException(401) on any failure."""
    try:
        payload = jwt.decode(
            token,
            key=_get_secret_key(),
            algorithms=[_get_algorithm()],
        )
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("JWT decode failed: token has expired.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.DecodeError:
        logger.warning("JWT decode failed: invalid token format.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as exc:
        logger.warning("JWT decode failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """FastAPI dependency — decode the bearer token and return the payload dict."""
    return decode_access_token(token)


def require_role(*roles: str):
    """Return a FastAPI dependency that raises HTTP 403 if the user's role is not
    in the provided *roles* tuple.

    Usage:
        @router.delete("/{id}", dependencies=[Depends(require_role(ROLES["ADMIN"]))])
    """
    def _role_guard(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return current_user

    return _role_guard
