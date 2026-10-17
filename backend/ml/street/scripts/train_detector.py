#!/usr/bin/env python3
"""Train the street barrier detector (Ultralytics YOLO11s).

Per the hackathon spec: imgsz 640, up to 100 epochs, patience 20, device
mps/cpu (Apple Silicon — no CUDA). Machine probe rule: time ONE epoch first;
if a full epoch takes > ~4 min on this machine, stop and use
ml/street/train_colab.ipynb instead (see --probe-only).

Usage:
  backend/tile2net/.venv/bin/python backend/ml/street/scripts/train_detector.py \
      --data backend/ml/street/data/yolo/data.yaml \
      --runs backend/ml/street/runs [--probe-only]
"""
from __future__ import annotations

import argparse
import json
import pathlib
import time


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="backend/ml/street/data/yolo/data.yaml")
    ap.add_argument("--runs", default="backend/ml/street/runs")
    ap.add_argument("--model", default="yolo11s.pt")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--patience", type=int, default=20)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--probe-only", action="store_true",
                    help="run 10 train steps, report seconds/epoch estimate")
    args = ap.parse_args()

    from ultralytics import YOLO

    out = pathlib.Path(args.runs)
    out.mkdir(parents=True, exist_ok=True)
    model = YOLO(args.model)

    if args.probe_only:
        t0 = time.time()
        # one tiny run to measure step time
        model.train(
            data=args.data, epochs=1, imgsz=args.imgsz, batch=args.batch,
            device=args.device, project=str(out), name="probe", exist_ok=True,
            cos_lr=False, patience=0, verbose=False,
        )
        elapsed = time.time() - t0
        print(json.dumps({
            "probe_wall_s": round(elapsed, 1),
            "note": "if probe epoch > ~240 s on GPU-equivalent, use Colab path",
        }, indent=2))
        return 0

    r = model.train(
        data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        device=args.device, project=str(out), name="yolo11s_street",
        patience=args.patience, exist_ok=True,
    )
    print("best:", out / "yolo11s_street" / "weights" / "best.pt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
