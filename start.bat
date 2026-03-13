@echo off
echo Starting BioMiND...
echo Generating data files...
python scripts/build.py
echo Starting server... please wait.
start /b python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080
timeout /t 2 /nobreak >nul
start "" http://localhost:8080
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080
