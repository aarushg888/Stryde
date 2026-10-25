#!/bin/sh
# Start the Stryde MVP backend (FastAPI on :8100) using the repo-root venv.
# API docs appear at http://localhost:8100/docs once running.
cd "$(dirname "$0")/.." || exit 1
if [ -x ".venv/bin/python" ]; then
  exec .venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8100
else
  exec python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8100
fi
