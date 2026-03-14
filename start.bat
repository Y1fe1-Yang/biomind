@echo off
REM BioMiND launcher — uses .venv if available, falls back to system Python

if exist ".venv\Scripts\python.exe" (
    set PYTHON=.venv\Scripts\python.exe
) else (
    set PYTHON=python
)

echo Starting BioMiND...
echo Generating data files...
%PYTHON% scripts/build.py

echo Starting server... please wait.
start /b %PYTHON% -m uvicorn backend.main:app --host 127.0.0.1 --port 8080
timeout /t 2 /nobreak >nul
start "" http://localhost:8080
%PYTHON% -m uvicorn backend.main:app --host 127.0.0.1 --port 8080
