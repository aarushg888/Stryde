#!/bin/sh
# Start the Stryde MVP backend (FastAPI on :8100). Needs weights for /detect.
# API docs appear at http://localhost:8100/docs once running.
cd "$(dirname "$0")/.." || exit 1
backend/tile2net/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8100
