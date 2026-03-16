from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

router = APIRouter(prefix="/api/files")

ROOT = Path(__file__).parent.parent.parent  # project root

# Subdirectory names that may be served via /api/files/
_ALLOWED_SUBDIRS = [
    "1.Journal Articles",
    "2.Conference Proceedings",
    "3.Books",
    "files",
]


@router.get("/{file_path:path}")
def serve_file(file_path: str):
    requested = (ROOT / file_path).resolve()

    # Compute allowed dirs from current ROOT so monkeypatching ROOT in tests works
    allowed_dirs = [ROOT / name for name in _ALLOWED_SUBDIRS]

    # Security: path must be inside one of the allowed directories
    allowed = any(
        requested == d.resolve() or d.resolve() in requested.parents
        for d in allowed_dirs
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    if not requested.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not requested.is_file():
        raise HTTPException(status_code=404, detail="Not a file")

    return FileResponse(str(requested))
