"""
Conversation persistence.

Conversations are stored as JSON files:
    conversations/{username}/{conv_id}.json

Each file contains a list of message objects:
    [{"role": "user"|"assistant", "content": "...", "ts": <unix float>}, ...]

Usage:
    from backend.services.conversation_store import (
        list_conversations, load_conversation, save_message, delete_conversation,
    )
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent.parent
CONV_DIR = ROOT / "conversations"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _conv_path(username: str, conv_id: str) -> Path:
    return CONV_DIR / username / f"{conv_id}.json"


def _ensure_dir(username: str) -> Path:
    d = CONV_DIR / username
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def new_conv_id() -> str:
    return uuid.uuid4().hex


def list_conversations(username: str) -> list[dict]:
    """Return metadata for all conversations belonging to *username*.

    Each item: {"conv_id": str, "title": str, "ts": float}
    Sorted newest first.
    """
    user_dir = CONV_DIR / username
    if not user_dir.exists():
        return []

    results = []
    for p in user_dir.glob("*.json"):
        try:
            messages = json.loads(p.read_text(encoding="utf-8"))
            first_user = next(
                (m["content"] for m in messages if m.get("role") == "user"), ""
            )
            title = first_user[:60] or p.stem
            ts = messages[-1]["ts"] if messages else p.stat().st_mtime
            results.append({"conv_id": p.stem, "title": title, "ts": ts})
        except (json.JSONDecodeError, KeyError, OSError):
            continue

    results.sort(key=lambda x: x["ts"], reverse=True)
    return results


def load_conversation(username: str, conv_id: str) -> list[dict]:
    """Return the message list for the given conversation (empty list if not found)."""
    path = _conv_path(username, conv_id)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def save_message(
    username: str,
    conv_id: str,
    role: str,
    content: str,
) -> dict[str, Any]:
    """Append one message to the conversation and persist to disk.

    Returns the saved message object.
    """
    _ensure_dir(username)
    path = _conv_path(username, conv_id)

    messages = load_conversation(username, conv_id)
    msg: dict[str, Any] = {"role": role, "content": content, "ts": time.time()}
    messages.append(msg)

    path.write_text(json.dumps(messages, ensure_ascii=False, indent=2), encoding="utf-8")
    return msg


def delete_conversation(username: str, conv_id: str) -> bool:
    """Delete a conversation file. Returns True if it existed."""
    path = _conv_path(username, conv_id)
    if path.exists():
        path.unlink()
        return True
    return False
