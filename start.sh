#!/bin/bash
# BioMiND launcher — uses .venv if available, falls back to system Python

if [ -f ".venv/bin/python" ]; then
    PYTHON=".venv/bin/python"
else
    PYTHON="python"
fi

echo "Starting BioMiND..."
echo "Generating data files..."
$PYTHON scripts/build.py

$PYTHON -m uvicorn backend.main:app --host 127.0.0.1 --port 8080 &
sleep 2
open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 2>/dev/null || true
wait
