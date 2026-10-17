#!/usr/bin/env python3
"""FastAPI service for the street barrier detector (C1 contract).

POST /detect — multipart upload (`file`), optional `conf` (default 0.25), max
10 MB; returns {"detections": [{"class", "confidence", "bbox"}...]}.
GET /health — {"ok": true, "weights": <path or null>}.

Run (CPU/MPS):
  backend/tile2net/.venv/bin/python -m uvicorn backend.ml.serve:app \
      --host 127.0.0.1 --port 8100

Example:
  curl -F "file=@img.jpg" "http://127.0.0.1:8100/detect?conf=0.25"
"""
from __future__ import annotations

import pathlib

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from backend.ml.street.scripts.detector import _load  # noqa: E402

MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB per spec

app = FastAPI(title="street barrier detector", version="1.0")


def _weights_path() -> str | None:
    from backend.ml.street.scripts.detector import WEIGHTS_CANDIDATES
    for cand in WEIGHTS_CANDIDATES:
        if cand.exists():
            return str(cand)
    return None


@app.get("/health")
def health():
    return {"ok": True, "weights": _weights_path()}


@app.post("/detect")
async def detect_endpoint(file: UploadFile = File(), conf: float = Form(0.25)):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="upload exceeds 10 MB")
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")
    try:
        from backend.ml.street.scripts.detector import detect
        return {"detections": detect(data, conf=conf)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
