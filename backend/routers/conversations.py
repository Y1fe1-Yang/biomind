"""
Conversation CRUD endpoints (requires JWT auth).

GET    /api/conversations              — list caller's conversations
GET    /api/conversations/{conv_id}    — get messages
DELETE /api/conversations/{conv_id}    — delete conversation
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import current_user
from backend.services.conversation_store import (
    delete_conversation,
    list_conversations,
    load_conversation,
)

router = APIRouter(prefix="/api/conversations")


@router.get("")
def get_conversations(user: dict = Depends(current_user)) -> list[dict]:
    return list_conversations(user["username"])


@router.get("/{conv_id}")
def get_conversation(conv_id: str, user: dict = Depends(current_user)) -> list[dict]:
    msgs = load_conversation(user["username"], conv_id)
    if not msgs:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return msgs


@router.delete("/{conv_id}")
def remove_conversation(conv_id: str, user: dict = Depends(current_user)) -> dict:
    if not delete_conversation(user["username"], conv_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": conv_id}
