"""
SOP/Share upload endpoints.

GET    /api/sops                          → list active sops (requires current_user)
                                            query param: ?type=sop|share (optional filter)
POST   /api/sops                          → upload (requires current_user)
GET    /api/sops/{sop_id}                 → get single sop (requires current_user)
PUT    /api/sops/{sop_id}                 → edit (owner or admin)
DELETE /api/sops/{sop_id}                 → hard delete (owner or admin)
POST   /api/admin/sops/{sop_id}/remove    → soft remove (admin only)
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.deps import admin_required, current_user
from backend.services import sop_store

router = APIRouter()

USER_SOPS_DIR = Path(__file__).parent.parent.parent / "data" / "user-sops"
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB

# MIME magic byte signatures
PDF_MAGIC  = b"%PDF"
DOCX_MAGIC = b"PK\x03\x04"


def _detect_file_type(ext: str, header: bytes) -> str:
    """Return 'pdf', 'docx', or raise HTTPException."""
    if ext == ".pdf":
        if not header.startswith(PDF_MAGIC):
            raise HTTPException(status_code=400, detail="File does not appear to be a valid PDF")
        return "pdf"
    elif ext in (".docx", ".doc"):
        if not header.startswith(DOCX_MAGIC):
            raise HTTPException(status_code=400, detail="File does not appear to be a valid DOCX")
        return "docx"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")


# ── Endpoints ──────────────────────────────────────────────────────

@router.get("/api/sops")
def list_sops(
    type: Optional[str] = None,
    user: dict = Depends(current_user),
):
    return sop_store.get_all_sops(type_filter=type)


@router.post("/api/sops", status_code=201)
async def upload_sop(
    type: str = Form(...),
    title_zh: str = Form(...),
    title_en: str = Form(""),
    description_zh: str = Form(""),
    description_en: str = Form(""),
    tags: str = Form(""),
    mdContent: str = Form(""),
    file: Optional[UploadFile] = File(None),
    user: dict = Depends(current_user),
):
    if type not in ("sop", "share"):
        raise HTTPException(status_code=400, detail="type must be 'sop' or 'share'")
    if not title_zh.strip():
        raise HTTPException(status_code=400, detail="title_zh is required")
    if not file and not mdContent.strip():
        raise HTTPException(status_code=400, detail="Either file or mdContent must be provided")

    username = user["username"]
    file_rel = ""
    file_type = "md"

    if file and file.filename:
        # Read all bytes to check size and magic
        raw = await file.read()
        if len(raw) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File exceeds 20 MB limit")

        ext = Path(file.filename).suffix.lower()
        header = raw[:4]
        file_type = _detect_file_type(ext, header)

        # Save to data/user-sops/{username}/{timestamp}{ext}
        user_dir = USER_SOPS_DIR / username
        user_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time() * 1000)
        dest = user_dir / f"{ts}{ext}"
        dest.write_bytes(raw)
        file_rel = f"user-sops/{username}/{ts}{ext}"
        md_content = ""
    else:
        md_content = mdContent.strip()

    # Generate ID
    from datetime import datetime
    date_str = datetime.utcnow().strftime("%Y-%m")
    sop_id = sop_store.generate_sop_id(type, username, date_str, title_zh)

    # Parse tags
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    sop_obj = {
        "id": sop_id,
        "type": type,
        "title": {"zh": title_zh, "en": title_en},
        "description": {"zh": description_zh, "en": description_en},
        "file": file_rel,
        "fileType": file_type,
        "mdContent": md_content,
        "tags": tag_list,
        "uploadedBy": username,
        "uploadedAt": time.time(),
        "updatedAt": None,
        "status": "active",
        "likeCount": 0,
        "bookmarkCount": 0,
        "commentCount": 0,
    }
    return sop_store.create_sop(sop_obj)


@router.get("/api/sops/{sop_id}")
def get_sop(sop_id: str, user: dict = Depends(current_user)):
    sop = sop_store.get_sop(sop_id)
    if not sop:
        raise HTTPException(status_code=404, detail="SOP not found")
    return sop


class SopUpdate(BaseModel):
    title_zh: Optional[str] = None
    title_en: Optional[str] = None
    description_zh: Optional[str] = None
    description_en: Optional[str] = None
    tags: Optional[list[str]] = None


@router.put("/api/sops/{sop_id}")
def edit_sop(sop_id: str, body: SopUpdate, user: dict = Depends(current_user)):
    sop = sop_store.get_sop(sop_id)
    if not sop:
        raise HTTPException(status_code=404, detail="SOP not found")
    if not user.get("is_admin") and sop.get("uploadedBy") != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized to edit this SOP")

    updates: dict = {}
    # Build title/description updates preserving existing values for missing fields
    existing_title = sop.get("title", {})
    existing_desc  = sop.get("description", {})
    new_title = dict(existing_title)
    new_desc  = dict(existing_desc)
    if body.title_zh is not None:
        new_title["zh"] = body.title_zh
    if body.title_en is not None:
        new_title["en"] = body.title_en
    if body.description_zh is not None:
        new_desc["zh"] = body.description_zh
    if body.description_en is not None:
        new_desc["en"] = body.description_en
    updates["title"] = new_title
    updates["description"] = new_desc
    if body.tags is not None:
        updates["tags"] = body.tags

    updated = sop_store.update_sop(sop_id, updates)
    return updated


@router.delete("/api/sops/{sop_id}")
def delete_sop(sop_id: str, user: dict = Depends(current_user)):
    sop = sop_store.get_sop(sop_id)
    if not sop:
        raise HTTPException(status_code=404, detail="SOP not found")
    if not user.get("is_admin") and sop.get("uploadedBy") != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized to delete this SOP")

    deleted = sop_store.delete_sop(sop_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="SOP not found")
    return {"ok": True}


@router.post("/api/admin/sops/{sop_id}/remove")
def admin_remove_sop(sop_id: str, _admin: dict = Depends(admin_required)):
    sop = sop_store.get_sop(sop_id)
    if not sop:
        raise HTTPException(status_code=404, detail="SOP not found")
    updated = sop_store.remove_sop(sop_id)
    return updated
