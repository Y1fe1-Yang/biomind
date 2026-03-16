"""
News CRUD endpoints.

GET    /api/news                — public, list all articles
POST   /api/news                — login required, create article
PUT    /api/news/{id}           — login required + (admin or author), update
DELETE /api/news/{id}           — admin only
POST   /api/news/images         — login required, upload image → returns URL
"""
from __future__ import annotations

import re
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from backend.deps import current_user, admin_required
from backend.services import news_store

router = APIRouter(prefix="/api/news")

IMAGES_DIR = Path(__file__).parent.parent.parent / "data" / "news-images"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


# ── Request models ─────────────────────────────────────────────────

class ArticleIn(BaseModel):
    title_zh: str
    title_en: str = ""
    excerpt_zh: str = ""
    excerpt_en: str = ""
    body_zh: str
    body_en: str = ""
    date: str            # YYYY-MM-DD
    cover_image: str = ""
    source: str = ""
    url: str = ""


# ── Endpoints ─────────────────────────────────────────────────────

@router.get("")
def list_articles():
    return news_store.load_news()


@router.post("/images")
async def upload_image(
    file: UploadFile = File(...),
    _user: dict = Depends(current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {ext}")

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"{int(time.time() * 1000)}{ext}"
    dest = IMAGES_DIR / fname
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    return {"url": f"/data/news-images/{fname}"}


@router.post("")
def create_article(body: ArticleIn, user: dict = Depends(current_user)):
    if not body.title_zh.strip():
        raise HTTPException(status_code=400, detail="title_zh is required")
    if not body.body_zh.strip():
        raise HTTPException(status_code=400, detail="body_zh is required")
    if not body.date:
        raise HTTPException(status_code=400, detail="date is required")

    slug = re.sub(r"[^\w\u4e00-\u9fff]", "-", body.title_zh[:24].lower())
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    article_id = f"{body.date[:7]}-{slug}"[:60]

    article = {
        "id": article_id,
        "date": body.date,
        "source": body.source or "siat.ac.cn",
        "url": body.url,
        "coverImage": body.cover_image,
        "title": {"zh": body.title_zh, "en": body.title_en},
        "excerpt": {"zh": body.excerpt_zh, "en": body.excerpt_en},
        "body": {"zh": body.body_zh, "en": body.body_en},
        "createdBy": user["username"],
        "createdAt": time.time(),
    }
    return news_store.create_article(article)


@router.put("/{article_id}")
def update_article(
    article_id: str,
    body: ArticleIn,
    user: dict = Depends(current_user),
):
    existing = news_store.get_article(article_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Article not found")
    if not user.get("is_admin") and existing.get("createdBy") != user["username"]:
        raise HTTPException(status_code=403, detail="Not authorized to edit this article")

    updates = {
        "date": body.date,
        "source": body.source,
        "url": body.url,
        "coverImage": body.cover_image,
        "title": {"zh": body.title_zh, "en": body.title_en},
        "excerpt": {"zh": body.excerpt_zh, "en": body.excerpt_en},
        "body": {"zh": body.body_zh, "en": body.body_en},
    }
    updated = news_store.update_article(article_id, updates)
    return updated


@router.delete("/{article_id}")
def delete_article(article_id: str, _: dict = Depends(admin_required)):
    if not news_store.delete_article(article_id):
        raise HTTPException(status_code=404, detail="Article not found")
    return {"ok": True}
