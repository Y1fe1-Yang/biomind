"""
POST /api/chat   — streaming SSE chat endpoint (requires JWT auth)

Request body:
    { "conv_id": "abc123", "message": "How do I do X?" }
    conv_id is optional — omit to start a new conversation.

Response: text/event-stream
    data: {"conv_id": "..."}          ← first event, so frontend can store it
    data: {"text": "<chunk>"}         ← zero or more text chunks
    data: {"error": "..."}            ← only on error
    data: [DONE]                      ← final event
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.deps import current_user
from backend.services.ai_client import get_provider
from backend.services.conversation_store import (
    load_conversation,
    new_conv_id,
    save_message,
)
from backend.services.rag import retrieve_with_content

router = APIRouter(prefix="/api/chat")

SYSTEM_PROMPT = """You are the BioMiND lab assistant for a biomedical engineering research group.
You help lab members find papers, understand protocols, draft documents, and answer research questions.
Be concise, precise, and scientific.
Respond in the same language the user writes in (Chinese or English).

Rules:
1. When answering based on the lab resources provided above, cite the source ID in \
parentheses, e.g. \"(来源：sop-micromachines2022-1)\".
2. When the lab resources do not contain relevant information, start your answer with \
\"[通用建议，非实验室记录] \" before responding with general knowledge.
3. Never fabricate lab data, protocol parameters, or paper conclusions."""


class ChatRequest(BaseModel):
    conv_id: str = ""
    message: str


@router.post("")
async def chat(
    req: ChatRequest,
    user: dict = Depends(current_user),
) -> StreamingResponse:
    username = user["username"]

    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message is empty")

    conv_id = req.conv_id or new_conv_id()

    history = load_conversation(username, conv_id)
    api_messages = [{"role": m["role"], "content": m["content"]} for m in history]

    hits = retrieve_with_content(req.message, top_k=5)
    context_block = _build_context(hits)
    user_content = req.message
    if context_block:
        user_content = f"{context_block}\n\n---\n\nUser question: {req.message}"

    api_messages.append({"role": "user", "content": user_content})
    save_message(username, conv_id, "user", req.message)

    provider = get_provider()

    async def event_stream():
        yield f"data: {json.dumps({'conv_id': conv_id})}\n\n"
        full_reply: list[str] = []
        try:
            async for chunk in provider.stream_chat(api_messages, system=SYSTEM_PROMPT):
                full_reply.append(chunk)
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        else:
            save_message(username, conv_id, "assistant", "".join(full_reply))
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


_TYPE_LABEL = {
    "sop": "SOP",
    "journal": "论文",
    "conference": "论文",
    "book": "书籍",
    "presentation": "分享",
}


def _build_context(hits: list[dict]) -> str:
    if not hits:
        return ""
    lines = ["以下是实验室相关资料：\n"]
    for h in hits:
        label = _TYPE_LABEL.get(h.get("type", ""), "资料")
        title = h.get("title", "Untitled")
        entry_id = h.get("id", "")
        content = h.get("content", "")

        lines.append(f"[{label}] {title} ({entry_id})")
        if content:
            prefix = "步骤摘要" if h.get("type") == "sop" else "摘要"
            lines.append(f"{prefix}:\n{content}")
        lines.append("")
    return "\n".join(lines)
