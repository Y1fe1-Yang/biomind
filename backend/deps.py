"""
FastAPI auth dependency.

Usage:
    from backend.deps import current_user

    @router.get("/protected")
    def handler(user: dict = Depends(current_user)):
        username = user["username"]
        is_admin = user["is_admin"]
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt as pyjwt

_bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        from backend.config import JWT_SECRET
        payload = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return {"username": payload["sub"], "is_admin": bool(payload.get("is_admin", False))}
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
