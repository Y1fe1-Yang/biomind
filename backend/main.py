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
from backend.services.user_store import ensure_admin_exists

app = FastAPI(title="BioMiND")


@app.on_event("startup")
def startup():
    ensure_admin_exists()

app.include_router(auth_router)
app.include_router(files_router)
app.include_router(downloads_router)
app.include_router(chat_router)
app.include_router(conversations_router)
app.include_router(sop_extract_router)
app.include_router(news_router)

@app.get("/api/health")
def health():
    return {"status": "ok"}

root = Path(__file__).parent.parent

# Serve data files (data.js, data.json)
data_dir = root / "data"
data_dir.mkdir(exist_ok=True)
app.mount("/data", StaticFiles(directory=str(data_dir)), name="data")

# Serve frontend
frontend_dir = root / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
