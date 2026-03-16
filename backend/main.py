from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from backend.routers.files import router as files_router
from backend.routers.downloads import router as downloads_router
from backend.routers.auth import router as auth_router
from backend.routers.chat import router as chat_router
from backend.routers.conversations import router as conversations_router
from backend.routers.sop_extract import router as sop_extract_router
from backend.routers.news import router as news_router
from backend.routers.admin import router as admin_router
from backend.routers.sops import router as sops_router
from backend.routers.social import router as social_router
from backend.services.user_store import ensure_admin_exists
from backend.services.social_store import _ensure_social_tables

app = FastAPI(title="BioMiND")


@app.on_event("startup")
def startup():
    ensure_admin_exists()
    _ensure_social_tables()

app.include_router(auth_router)
app.include_router(files_router)
app.include_router(downloads_router)
app.include_router(chat_router)
app.include_router(conversations_router)
app.include_router(sop_extract_router)
app.include_router(news_router)
app.include_router(admin_router)
app.include_router(sops_router)
app.include_router(social_router)

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/debug/files")
def debug_files():
    import os
    root = Path(__file__).parent.parent
    data_dir = root / "data"
    return {
        "cwd": os.getcwd(),
        "root": str(root),
        "data_dir": str(data_dir),
        "data_exists": data_dir.exists(),
        "data_files": [f.name for f in data_dir.iterdir()][:20] if data_dir.exists() else [],
        "frontend_exists": (root / "frontend").exists(),
    }

root = Path(__file__).parent.parent

# Serve data files (data.js, data.json, user-sops/, etc.)
data_dir = root / "data"
data_dir.mkdir(exist_ok=True)
# Ensure user-sops directory exists
(root / "data" / "user-sops").mkdir(exist_ok=True)
app.mount("/data", StaticFiles(directory=str(data_dir)), name="data")

# Serve frontend
frontend_dir = root / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
