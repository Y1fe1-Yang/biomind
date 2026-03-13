from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter(prefix="/api/files")

ROOT = Path(__file__).parent.parent.parent  # project root


@router.get("/{file_path:path}")
def serve_file(file_path: str):
    # Security: resolve and validate path stays within files/ directory.
    # Use parents check (not startswith) to prevent sibling-directory attacks
    # e.g. "files_evil/" starts with "files/" but is not inside it.
    safe_root = (ROOT / "files").resolve()
    requested = (ROOT / file_path).resolve()

    if safe_root != requested and safe_root not in requested.parents:
        raise HTTPException(status_code=403, detail="Access denied")
    if not requested.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not requested.is_file():
        raise HTTPException(status_code=404, detail="Not a file")

    return FileResponse(str(requested))
