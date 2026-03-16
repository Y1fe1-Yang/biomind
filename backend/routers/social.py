"""
Social feature endpoints: likes, bookmarks, comments for SOPs.

POST   /api/sops/{sop_id}/like                  — toggle like (auth required)
POST   /api/sops/{sop_id}/bookmark              — toggle bookmark (auth required)
GET    /api/sops/{sop_id}/comments              — list comments (auth required)
POST   /api/sops/{sop_id}/comments              — add comment (auth required)
DELETE /api/sops/{sop_id}/comments/{comment_id} — delete comment (owner or admin)

GET    /api/me/likes      — sop_ids liked by current user
GET    /api/me/bookmarks  — sop_ids bookmarked by current user
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.deps import current_user
from backend.services import social_store

router = APIRouter()


# ── Request models ─────────────────────────────────────────────────

class CommentIn(BaseModel):
    content: str


# ── Like endpoints ─────────────────────────────────────────────────

@router.post("/api/sops/{sop_id}/like")
def like_sop(sop_id: str, user: dict = Depends(current_user)):
    return social_store.toggle_like(sop_id, user["username"])


# ── Bookmark endpoints ─────────────────────────────────────────────

@router.post("/api/sops/{sop_id}/bookmark")
def bookmark_sop(sop_id: str, user: dict = Depends(current_user)):
    return social_store.toggle_bookmark(sop_id, user["username"])


# ── Comment endpoints ──────────────────────────────────────────────

@router.get("/api/sops/{sop_id}/comments")
def list_comments(sop_id: str, _user: dict = Depends(current_user)):
    return social_store.get_comments(sop_id)


@router.post("/api/sops/{sop_id}/comments", status_code=201)
def create_comment(sop_id: str, body: CommentIn, user: dict = Depends(current_user)):
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Comment content cannot be empty")
    if len(content) > 500:
        raise HTTPException(status_code=400, detail="Comment exceeds 500 characters")
    return social_store.add_comment(sop_id, user["username"], content)


@router.delete("/api/sops/{sop_id}/comments/{comment_id}")
def remove_comment(
    sop_id: str,
    comment_id: int,
    user: dict = Depends(current_user),
):
    deleted = social_store.delete_comment(
        comment_id,
        username=user["username"],
        is_admin=user.get("is_admin", False),
    )
    if not deleted:
        raise HTTPException(
            status_code=403,
            detail="Comment not found or not authorized to delete",
        )
    return {"ok": True}


# ── Me endpoints ───────────────────────────────────────────────────

@router.get("/api/me/likes")
def my_likes(user: dict = Depends(current_user)):
    return social_store.get_user_likes(user["username"])


@router.get("/api/me/bookmarks")
def my_bookmarks(user: dict = Depends(current_user)):
    return social_store.get_user_bookmarks(user["username"])
