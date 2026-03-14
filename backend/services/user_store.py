"""
User storage backed by SQLite.

DB file: data/users.db
Table: users (id, username, password_hash, is_admin, created_at)

The first registered user automatically becomes admin.
"""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path

import bcrypt

ROOT = Path(__file__).parent.parent.parent
DB_PATH = ROOT / "data" / "users.db"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    return c


def _ensure_tables() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                username     TEXT    UNIQUE NOT NULL,
                password_hash TEXT   NOT NULL,
                is_admin     INTEGER NOT NULL DEFAULT 0,
                created_at   REAL    NOT NULL
            )
        """)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def register_user(username: str, password: str) -> dict:
    """Create a user. First user becomes admin. Raises ValueError if username taken."""
    _ensure_tables()
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    with _conn() as c:
        count = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        is_admin = 1 if count == 0 else 0
        try:
            c.execute(
                "INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?,?,?,?)",
                (username, hashed, is_admin, time.time()),
            )
        except sqlite3.IntegrityError:
            raise ValueError("Username already taken")
    return get_user(username)  # type: ignore[return-value]


def verify_password(username: str, password: str) -> dict | None:
    """Check credentials. Returns user dict on success, None on failure."""
    _ensure_tables()
    with _conn() as c:
        row = c.execute(
            "SELECT username, password_hash, is_admin FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    if row is None:
        return None
    if not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        return None
    return {"username": row["username"], "is_admin": bool(row["is_admin"])}


def get_user(username: str) -> dict | None:
    _ensure_tables()
    with _conn() as c:
        row = c.execute(
            "SELECT id, username, is_admin, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    return dict(row) if row else None


def list_users() -> list[dict]:
    _ensure_tables()
    with _conn() as c:
        rows = c.execute(
            "SELECT id, username, is_admin, created_at FROM users ORDER BY created_at"
        ).fetchall()
    return [dict(r) for r in rows]


def ensure_admin_exists() -> None:
    """Create default admin/admin account if no users exist yet."""
    _ensure_tables()
    with _conn() as c:
        count = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count == 0:
        register_user("admin", "admin")
