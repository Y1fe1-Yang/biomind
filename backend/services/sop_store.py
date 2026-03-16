"""User SOP/share storage backed by data/user-sops.json."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
SOPS_PATH = ROOT / "data" / "user-sops.json"
USER_SOPS_DIR = ROOT / "data" / "user-sops"


def generate_sop_id(type_: str, username: str, date_str: str, title_zh: str) -> str:
    """Generate a unique SOP id.

    date_str = "YYYY-MM"
    slug = re.sub(r'[^a-z0-9]+', '-', title_zh[:20].lower()).strip('-')
    id_ = f"{type_}-{username}-{date_str}-{slug}"
    return id_[:60]
    """
    slug = re.sub(r"[^a-z0-9]+", "-", title_zh[:20].lower()).strip("-")
    id_ = f"{type_}-{username}-{date_str}-{slug}"
    return id_[:60]


def load_sops() -> list[dict]:
    if not SOPS_PATH.exists():
        return []
    return json.loads(SOPS_PATH.read_text(encoding="utf-8"))


def save_sops(sops: list[dict]) -> None:
    SOPS_PATH.write_text(
        json.dumps(sops, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_all_sops(type_filter: str | None = None) -> list[dict]:
    """Return only status='active' SOPs, optionally filtered by type."""
    sops = load_sops()
    result = [s for s in sops if s.get("status") == "active"]
    if type_filter:
        result = [s for s in result if s.get("type") == type_filter]
    return result


def get_sop(sop_id: str) -> dict | None:
    return next((s for s in load_sops() if s["id"] == sop_id), None)


def create_sop(data: dict) -> dict:
    sops = load_sops()
    sops.append(data)
    save_sops(sops)
    return data


def update_sop(sop_id: str, updates: dict) -> dict | None:
    """Update title/description/tags, sets updatedAt = time.time()."""
    sops = load_sops()
    for i, s in enumerate(sops):
        if s["id"] == sop_id:
            sops[i] = {**s, **updates, "updatedAt": time.time()}
            save_sops(sops)
            return sops[i]
    return None


def delete_sop(sop_id: str) -> dict | None:
    """Hard delete: removes from list AND deletes physical file (if file field non-empty).
    Returns the deleted item or None.
    """
    sops = load_sops()
    target = None
    for s in sops:
        if s["id"] == sop_id:
            target = s
            break
    if target is None:
        return None

    # Delete physical file if present
    file_rel = target.get("file", "")
    if file_rel:
        file_path = ROOT / "data" / file_rel
        if file_path.exists():
            try:
                file_path.unlink()
            except OSError:
                pass

    filtered = [s for s in sops if s["id"] != sop_id]
    save_sops(filtered)
    return target


def remove_sop(sop_id: str) -> dict | None:
    """Soft delete: sets status='removed', returns updated item."""
    sops = load_sops()
    for i, s in enumerate(sops):
        if s["id"] == sop_id:
            sops[i] = {**s, "status": "removed", "updatedAt": time.time()}
            save_sops(sops)
            return sops[i]
    return None
