from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter(prefix="/api/files")

ROOT = Path(__file__).parent.parent.parent  # project root

# Directories that may be served via /api/files/
ALLOWED_DIRS = [
    ROOT / "1.Journal Articles",
    ROOT / "2.Conference Proceedings",
    ROOT / "3.Books",
    ROOT / "files",
]


@router.get("/{file_path:path}")
def serve_file(file_path: str):
    requested = (ROOT / file_path).resolve()

    # Security: path must be inside one of the allowed directories
    allowed = any(
        requested == d.resolve() or d.resolve() in requested.parents
        for d in ALLOWED_DIRS
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    if not requested.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not requested.is_file():
        raise HTTPException(status_code=404, detail="Not a file")

    return FileResponse(str(requested))
