"""
Auth endpoints.

POST /api/auth/register  — register a new user
POST /api/auth/login     — get JWT access token
GET  /api/auth/me        — validate token, return user info
"""

from __future__ import annotations

import time

import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.deps import current_user
from backend.services.user_store import register_user, verify_password

router = APIRouter(prefix="/api/auth")

_TOKEN_EXPIRY_SECONDS = 7 * 24 * 3600  # 7 days


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    username: str
    is_admin: bool


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _issue_token(username: str, is_admin: bool) -> str:
    from backend.config import JWT_SECRET
    payload = {
        "sub": username,
        "is_admin": is_admin,
        "exp": time.time() + _TOKEN_EXPIRY_SECONDS,
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest) -> dict:
    if not req.username.strip():
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    try:
        user = register_user(req.username.strip(), req.password)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    token = _issue_token(user["username"], bool(user["is_admin"]))
    return {"access_token": token, "username": user["username"], "is_admin": bool(user["is_admin"])}


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest) -> dict:
    user = verify_password(req.username.strip(), req.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Username or password incorrect")
    token = _issue_token(user["username"], user["is_admin"])
    return {"access_token": token, "username": user["username"], "is_admin": user["is_admin"]}


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict:
    return user
