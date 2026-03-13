#!/bin/bash
echo "Starting BioMiND..."
echo "Generating data files..."
python scripts/build.py
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8080 &
sleep 2
open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 2>/dev/null || true
wait
