#!/usr/bin/env python3
"""Evaluate the trained detector on the held-out split (B3).

Writes backend/ml/street/metrics/street.json.MODEL — see task spec; per-class
mAP50/mAP50-95 on the test images only, plus the module-level val split. Never
tunes on test. Run only after weights exist.

backend/tile2net/.venv/bin/python backend/ml/street/scripts/eval_detector.py \
    --weights backend/ml/street/weights/best.pt \
    --data backend/ml/street/data/yolo/data.yaml
"""
from __future__ import annotations

import argparse
import json
import pathlib


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="backend/ml/street/weights/best.pt")
    ap.add_argument("--data", default="backend/ml/street/data/yolo/data.yaml")
    ap.add_argument("--out", default="backend/ml/street/metrics/street.json")
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    from ultralytics import YOLO

    model = YOLO(args.weights)
    out = {}
    for split in ("val", "test"):
        r = model.val(
            data=args.data, split=split, imgsz=640, device=args.device,
            plots=True, project="backend/ml/street/runs", name=f"eval_{split}",
            exist_ok=True, save_json=False, verbose=False)
        d = r.results_dict  # map/precision/recall mAP50
        per = {}
        for i, name in model.names.items():
            try:
                per[name] = {
                    "P": round(float(r.box.p[i]), 4),
                    "R": round(float(r.box.r[i]), 4),
                    "mAP50": round(float(r.box.ap50[i]), 4),
                    "mAP50-95": round(float(r.box.ap[i]), 4),
                }
            except IndexError:
                continue
        out[split] = {"overall": {k: round(float(v), 4) for k, v in d.items()},
                      "per_class": per}
    pathlib.Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(args.out).write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
