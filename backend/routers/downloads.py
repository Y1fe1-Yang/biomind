from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter(prefix="/api/download")
ROOT = Path(__file__).parent.parent.parent


@router.get("/{username}/{conv_id}/{filename}")
def download_generated(username: str, conv_id: str, filename: str):
    safe_root = (ROOT / "files" / "generated").resolve()
    requested = (safe_root / username / conv_id / filename).resolve()
    if safe_root != requested and safe_root not in requested.parents:
        raise HTTPException(status_code=403, detail="Access denied")
    if not requested.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(requested))
