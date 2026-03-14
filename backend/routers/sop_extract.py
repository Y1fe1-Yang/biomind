"""
POST /api/extract-sop  — on-demand SOP extraction (admin only, SSE)

Request body: { "paper_id": "labchip2022" }

SSE events:
    data: {"type": "progress", "status": "extracting", "message": "..."}
    data: {"type": "progress", "status": "ai_processing", "message": "..."}
    data: {"type": "done", "sop_ids": ["sop-labchip2022-1"]}
    data: {"type": "error", "message": "..."}
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from backend.config import CLAUDE_API_KEY
from backend.deps import current_user
import backend.services.sop_service as sop_service
import scripts.build as _build

router = APIRouter(prefix="/api")

_ROOT = Path(__file__).parent.parent.parent


class ExtractRequest(BaseModel):
    paper_id: str


@router.post("/extract-sop")
async def extract_sop(
    req: ExtractRequest,
    user: dict = Depends(current_user),
):
    if not user["is_admin"]:
        return JSONResponse({"detail": "Admin only"}, status_code=403)

    # Load data.json to find the paper
    data_path = _ROOT / "data" / "data.json"
    try:
        data = json.loads(data_path.read_text(encoding="utf-8"))
    except Exception:
        return JSONResponse({"detail": "data.json not found"}, status_code=500)

    paper = next((p for p in data.get("papers", []) if p["id"] == req.paper_id), None)
    if paper is None:
        return JSONResponse({"detail": f"Paper '{req.paper_id}' not found"}, status_code=404)

    async def event_stream():
        yield _sse({"type": "progress", "status": "extracting",
                    "message": "正在提取 PDF 文本..."})
        try:
            existing_sops = data.get("sops", [])
            yield _sse({"type": "progress", "status": "ai_processing",
                        "message": "AI 分析中..."})
            new_entries = await sop_service.extract_sop_for_paper(
                paper=paper, root=_ROOT, api_key=CLAUDE_API_KEY,
                existing_sops=existing_sops,
            )

            if not new_entries:
                yield _sse({"type": "error",
                            "message": "无法提取 SOP：PDF 文本不足且无 DOI 摘要"})
                return

            # Write to data.json (idempotent: remove any prior auto SOPs for this paper)
            data["sops"] = [
                s for s in existing_sops
                if s.get("source_paper_id") != req.paper_id
            ] + new_entries
            data_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            # Regenerate data.js in thread pool (non-blocking)
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                None, lambda: _build.generate_data_files(root=_ROOT, rebuild=False)
            )

            yield _sse({"type": "done", "sop_ids": [e["id"] for e in new_entries]})

        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
