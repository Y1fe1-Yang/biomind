from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from backend.routers.files import router as files_router
from backend.routers.downloads import router as downloads_router

app = FastAPI(title="BioMiND")

app.include_router(files_router)
app.include_router(downloads_router)

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
