"""
Admin CRUD endpoints — all require admin JWT.

GET    /api/admin/members              — list all members
POST   /api/admin/members              — add member
PUT    /api/admin/members/{member_id}  — update member
DELETE /api/admin/members/{member_id}  — delete member

PUT    /api/admin/papers/{paper_id}    — edit paper/book metadata

GET    /api/admin/ai-config            — get masked AI config
PUT    /api/admin/ai-config            — update AI provider/keys

GET    /api/admin/footer               — get footer links
PUT    /api/admin/footer               — update footer links
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import admin_required
from backend.services import members_store, ai_config_store, data_store

router = APIRouter(prefix="/api/admin")

ROOT = Path(__file__).parent.parent.parent
FOOTER_PATH = ROOT / "data" / "footer_config.json"

_FOOTER_DEFAULTS: dict = {"links": []}


# ---------------------------------------------------------------------------
# Footer helpers (inline — no separate store for a simple JSON file)
# ---------------------------------------------------------------------------

def _load_footer() -> dict:
    if not FOOTER_PATH.exists():
        return dict(_FOOTER_DEFAULTS)
    return json.loads(FOOTER_PATH.read_text(encoding="utf-8"))


def _save_footer(data: dict) -> None:
    FOOTER_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

@router.get("/members")
def list_members(_: dict = Depends(admin_required)) -> list:
    return members_store.load_members()


@router.post("/members")
def add_member(body: dict, _: dict = Depends(admin_required)) -> dict:
    if not body.get("id"):
        raise HTTPException(status_code=400, detail="member must have an 'id' field")
    try:
        return members_store.add_member(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/members/{member_id}")
def update_member(member_id: str, body: dict, _: dict = Depends(admin_required)) -> dict:
    result = members_store.update_member(member_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return result


@router.delete("/members/{member_id}")
def delete_member(member_id: str, _: dict = Depends(admin_required)) -> dict:
    if not members_store.delete_member(member_id):
        raise HTTPException(status_code=404, detail="Member not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Papers / Books
# ---------------------------------------------------------------------------

@router.put("/papers/{paper_id}")
def update_paper(paper_id: str, body: dict, _: dict = Depends(admin_required)) -> dict:
    result = data_store.save_paper(paper_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail="Paper not found")
    return result


# ---------------------------------------------------------------------------
# AI Config
# ---------------------------------------------------------------------------

@router.get("/ai-config")
def get_ai_config(_: dict = Depends(admin_required)) -> dict:
    return ai_config_store.get_masked_config()


@router.put("/ai-config")
def update_ai_config(body: dict, _: dict = Depends(admin_required)) -> dict:
    ai_config_store.update_config(body)
    return ai_config_store.get_masked_config()


# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------

@router.get("/footer")
def get_footer(_: dict = Depends(admin_required)) -> dict:
    return _load_footer()


@router.put("/footer")
def update_footer(body: dict, _: dict = Depends(admin_required)) -> dict:
    if "links" not in body or not isinstance(body["links"], list):
        raise HTTPException(status_code=400, detail="body must contain 'links' list")
    data = {"links": body["links"]}
    _save_footer(data)
    return data
