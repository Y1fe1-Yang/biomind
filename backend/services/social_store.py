"""
Social features store: likes, bookmarks, comments for SOPs.

Uses the same SQLite database (data/users.db) with three extra tables.
Counts are also mirrored into data/user-sops.json for quick reads.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
DB_PATH = ROOT / "data" / "users.db"
SOPS_PATH = ROOT / "data" / "user-sops.json"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_social_tables() -> None:
    """Create social tables if they don't exist (idempotent)."""
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sop_likes (
                sop_id     TEXT NOT NULL,
                username   TEXT NOT NULL,
                created_at REAL NOT NULL,
                PRIMARY KEY (sop_id, username)
            );
            CREATE TABLE IF NOT EXISTS sop_bookmarks (
                sop_id     TEXT NOT NULL,
                username   TEXT NOT NULL,
                created_at REAL NOT NULL,
                PRIMARY KEY (sop_id, username)
            );
            CREATE TABLE IF NOT EXISTS sop_comments (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                sop_id     TEXT NOT NULL,
                username   TEXT NOT NULL,
                content    TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_comments_sop ON sop_comments(sop_id);
        """)


def _update_sop_counts(
    sop_id: str,
    like_delta: int = 0,
    bookmark_delta: int = 0,
    comment_delta: int = 0,
) -> None:
    """Update likeCount/bookmarkCount/commentCount in user-sops.json."""
    if not SOPS_PATH.exists():
        return
    sops = json.loads(SOPS_PATH.read_text(encoding="utf-8"))
    for sop in sops:
        if sop.get("id") == sop_id:
            if like_delta:
                sop["likeCount"] = max(0, sop.get("likeCount", 0) + like_delta)
            if bookmark_delta:
                sop["bookmarkCount"] = max(0, sop.get("bookmarkCount", 0) + bookmark_delta)
            if comment_delta:
                sop["commentCount"] = max(0, sop.get("commentCount", 0) + comment_delta)
            break
    SOPS_PATH.write_text(json.dumps(sops, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Likes ──────────────────────────────────────────────────────────

def toggle_like(sop_id: str, username: str) -> dict:
    """Toggle like. Returns {"liked": bool, "count": int}"""
    _ensure_social_tables()
    with _get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM sop_likes WHERE sop_id=? AND username=?",
            (sop_id, username),
        ).fetchone()
        if existing:
            conn.execute(
                "DELETE FROM sop_likes WHERE sop_id=? AND username=?",
                (sop_id, username),
            )
            _update_sop_counts(sop_id, like_delta=-1)
            liked = False
        else:
            conn.execute(
                "INSERT INTO sop_likes VALUES (?,?,?)",
                (sop_id, username, time.time()),
            )
            _update_sop_counts(sop_id, like_delta=1)
            liked = True
        count = conn.execute(
            "SELECT COUNT(*) FROM sop_likes WHERE sop_id=?",
            (sop_id,),
        ).fetchone()[0]
    return {"liked": liked, "count": count}


# ── Bookmarks ──────────────────────────────────────────────────────

def toggle_bookmark(sop_id: str, username: str) -> dict:
    """Toggle bookmark. Returns {"bookmarked": bool, "count": int}"""
    _ensure_social_tables()
    with _get_conn() as conn:
        existing = conn.execute(
            "SELECT 1 FROM sop_bookmarks WHERE sop_id=? AND username=?",
            (sop_id, username),
        ).fetchone()
        if existing:
            conn.execute(
                "DELETE FROM sop_bookmarks WHERE sop_id=? AND username=?",
                (sop_id, username),
            )
            _update_sop_counts(sop_id, bookmark_delta=-1)
            bookmarked = False
        else:
            conn.execute(
                "INSERT INTO sop_bookmarks VALUES (?,?,?)",
                (sop_id, username, time.time()),
            )
            _update_sop_counts(sop_id, bookmark_delta=1)
            bookmarked = True
        count = conn.execute(
            "SELECT COUNT(*) FROM sop_bookmarks WHERE sop_id=?",
            (sop_id,),
        ).fetchone()[0]
    return {"bookmarked": bookmarked, "count": count}


# ── Comments ───────────────────────────────────────────────────────

def get_comments(sop_id: str) -> list[dict]:
    """Return comments for a SOP, ordered by created_at ASC."""
    _ensure_social_tables()
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT id, sop_id, username, content, created_at "
            "FROM sop_comments WHERE sop_id=? ORDER BY created_at ASC",
            (sop_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def add_comment(sop_id: str, username: str, content: str) -> dict:
    """Add a comment. content max 500 chars (caller should validate). Returns new comment."""
    _ensure_social_tables()
    now = time.time()
    with _get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO sop_comments (sop_id, username, content, created_at) VALUES (?,?,?,?)",
            (sop_id, username, content, now),
        )
        comment_id = cursor.lastrowid
    _update_sop_counts(sop_id, comment_delta=1)
    return {
        "id": comment_id,
        "sop_id": sop_id,
        "username": username,
        "content": content,
        "created_at": now,
    }


def delete_comment(comment_id: int, username: str, is_admin: bool) -> bool:
    """Delete a comment. Only owner or admin. Returns True if deleted."""
    _ensure_social_tables()
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT sop_id, username FROM sop_comments WHERE id=?",
            (comment_id,),
        ).fetchone()
        if not row:
            return False
        if row["username"] != username and not is_admin:
            return False
        sop_id = row["sop_id"]
        conn.execute("DELETE FROM sop_comments WHERE id=?", (comment_id,))
    _update_sop_counts(sop_id, comment_delta=-1)
    return True


# ── Per-user queries ───────────────────────────────────────────────

def get_user_likes(username: str) -> list[str]:
    """Return list of sop_ids liked by user."""
    _ensure_social_tables()
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT sop_id FROM sop_likes WHERE username=?",
            (username,),
        ).fetchall()
    return [r[0] for r in rows]


def get_user_bookmarks(username: str) -> list[str]:
    """Return list of sop_ids bookmarked by user."""
    _ensure_social_tables()
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT sop_id FROM sop_bookmarks WHERE username=?",
            (username,),
        ).fetchall()
    return [r[0] for r in rows]
