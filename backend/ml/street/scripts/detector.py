#!/usr/bin/env python3
"""detect(): run the trained street barrier detector on image bytes.

Contract (per spec):
  detections = detect(image_bytes, conf=0.25)
  -> [{"class": str, "confidence": float, "bbox": [x1, y1, x2, y2]}, ...]

Weights land in backend/ml/street/weights/best.pt after training (local MPS or
Colab; not committed). CLI:

  backend/tile2net/.venv/bin/python backend/ml/street/scripts/detector.py \
      detect --image path/to/img.jpg [--conf 0.25]

The FastAPI service (backend/ml/serve.py) calls this same function on uploads.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import pathlib

WEIGHTS_CANDIDATES = (
    pathlib.Path("backend/ml/street/weights/best.pt"),
    pathlib.Path("backend/ml/street/runs/yolo11s_street/weights/best.pt"),
)
_WEIGHTS = None
_MODEL = None


def _load():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    global _WEIGHTS
    if _WEIGHTS is None:
        for cand in WEIGHTS_CANDIDATES:
            if cand.exists():
                _WEIGHTS = cand
                break
        if _WEIGHTS is None:
            raise FileNotFoundError(
                "no trained weights found. Train first: "
                "backend/tile2net/.venv/bin/python "
                "backend/ml/street/scripts/train_detector.py (or Colab notebook), "
                "then copy best.pt to backend/ml/street/weights/best.pt")
    from ultralytics import YOLO
    _MODEL = YOLO(str(_WEIGHTS))
    return _MODEL


def detect(image_bytes: bytes, conf: float = 0.25) -> list:
    model = _load()
    from PIL import Image
    im = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    results = model.predict(im, conf=conf, verbose=False)
    out = []
    names = results[0].names
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0].tolist())
            out.append({
                "class": names[int(box.cls.item())],
                "confidence": round(float(box.conf.item()), 4),
                "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            })
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, prog="detector")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect", help="detect barriers in an image file")
    d.add_argument("--image", required=True)
    d.add_argument("--conf", type=float, default=0.25)
    d.add_argument("--json", action="store_true", help="pretty JSON output")
    e = sub.add_parser("export-onnx", help="export weights/best.pt to ONNX")
    e.add_argument("--out", default="backend/ml/street/weights/best.onnx")
    args = ap.parse_args()

    if args.cmd == "export-onnx":
        model = _load()
        path = model.export(format="onnx")
        print("onnx written:", path)
        return 0

    with open(args.image, "rb") as f:
        img = f.read()
    res = detect(img, conf=args.conf)
    if args.json:
        print(json.dumps(res, indent=2))
    else:
        for r in res:
            print(r)


if __name__ == "__main__":
    main()
