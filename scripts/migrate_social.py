"""
migrate_social.py — Create social tables in data/users.db (idempotent).

Run once before deploying sop-social features:
    python scripts/migrate_social.py
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "users.db"


def run():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(DB_PATH)) as conn:
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

            CREATE INDEX IF NOT EXISTS idx_comments_sop
                ON sop_comments(sop_id);
        """)
    print(f"Social tables created/verified in {DB_PATH}")


if __name__ == "__main__":
    run()
