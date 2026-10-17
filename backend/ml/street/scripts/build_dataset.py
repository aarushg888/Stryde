#!/usr/bin/env python3
"""Build the unified ml/street YOLO dataset.

Reads the four raw datasets (3 Roboflow YOLOv8 exports + Wheelmap Zenodo,
converted on the fly from CVAT XML), maps classes per configs/classes.yaml,
deduplicates near-identical images with perceptual hashing (BEFORE split),
then writes an 80/10/10 stratified split (anchor = rarest class in image)
into data/yolo/{train,val,test}, with per-class instance counts and a
report flagging classes under 150 train instances.

Usage:
  backend/tile2net/.venv/bin/python backend/ml/street/scripts/build_dataset.py \
      --classes backend/ml/street/configs/classes.yaml \
      --out backend/ml/street/data/yolo
"""
from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import itertools
import json
import pathlib
import random
import shutil
import xml.etree.ElementTree as ET

import numpy as np
import yaml
from PIL import Image

ROBOFLOW_DIRS = ("sidewalksidewalk_v10", "logan_intersections_v1", "combined_proj_v2")
SPLIT = ("train", "valid", "test")

PIL_HASH_KW = dict(hash_size=8, highfreq_factor=4)  # 64-bit phash for speed
try:
    import imagehash

    def phash(path):
        with Image.open(path) as im:
            return imagehash.phash(im.convert("L"), **PIL_HASH_KW)
except ImportError:  # pragma: no cover
    imagehash = None


def md5(path):
    return hashlib.md5(pathlib.Path(path).read_bytes()).hexdigest()


def load_roboflow(root: pathlib.Path, dataset: str, mapping):
    """dataset['train'|'test'|'valid'] structure from a roboflow export."""
    out = {}
    images = []
    for sp in SPLIT:
        d = root / dataset / sp
        images += sorted((d / "images").glob("*"))
    names = yaml.safe_load((root / dataset / "data.yaml").read_text())["names"]
    for img in images:
        lbl = (root / dataset / pick_split(img, root, dataset) / "labels" /
               (img.stem + ".txt"))
        boxes = []
        w, h = Image.open(img).size
        if lbl.exists():
            for line in lbl.read_text().splitlines():
                p = line.split()
                if len(p) == 5:
                    cls_native = names[int(p[0])]
                    cls_target = mapping[dataset].get(cls_native)
                    if cls_target:
                        # xywh -> pixel xyxy
                        cx, cy, bw, bh = (float(v) for v in p[1:])
                        x1 = (cx - bw / 2) * w
                        y1 = (cy - bh / 2) * h
                        x2 = (cx + bw / 2) * w
                        y2 = (cy + bh / 2) * h
                        boxes.append((cls_target, x1, y1, x2, y2))
        out[img] = dict(src=dataset, size=(w, h), boxes=boxes)
    return out


def pick_split(img, root, dataset):
    for sp in SPLIT:
        if (root / dataset / sp / "images").is_dir():
            q = root / dataset / sp / "images" / img.name
            if q.exists():
                return sp
    raise FileNotFoundError(img)


def load_wheelmap(xml_path: pathlib.Path, img_dir: pathlib.Path, mapping):
    root = ET.parse(xml_path).getroot()
    out = {}
    m = mapping["wheelmap"]
    for im in root.findall("image"):
        name = im.attrib["name"].split("/")[-1]
        p = img_dir / name
        if not p.exists():
            continue
        # skip images that only contain dropped (grab_bar) boxes
        boxes = []
        for b in im.findall("box"):
            cls_target = m.get(b.attrib["label"])
            if cls_target:
                boxes.append((cls_target, float(b.attrib["xtl"]), float(b.attrib["ytl"]),
                              float(b.attrib["xbr"]), float(b.attrib["ybr"])))
        if not boxes:
            continue
        out[p] = dict(src="wheelmap", size=(int(im.attrib["width"]), int(im.attrib["height"])),
                      boxes=boxes)
    return out


def build_mapping(classes_cfg):
    m = collections.defaultdict(dict)
    target_names = [c["name"] for c in classes_cfg["classes"]]
    for c in classes_cfg["classes"]:
        for ds, srcc in c["sources"].items():
            for s in ([srcc] if isinstance(srcc, str) else srcc):
                m[ds][s] = c["name"]
    return dict(m), target_names


def dedupe(index, hash_thresh=4):
    """Union-find dedupe by phash hamming distance <= hash_thresh (before split)."""
    hashes, hashes_u16 = {}, []
    for p in list(index.keys()):
        h = phash(str(p))
        arr = np.array(h.hash).flatten()  # 256 bits
        hashes[p] = arr
    N = len(hashes)
    paths = list(hashes.keys())
    bits = np.stack([hashes[p] for p in paths])  # (N, 256) bool

    parent = dict((p, p) for p in paths)

    def find(p):
        while parent[p] != p:
            parent[p] = parent[parent[p]]
            p = parent[p]
        return p

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    CH = 512
    for i in range(0, N, CH):
        xb = bits[i:i + CH]  # (C,256)
        d = (np.count_nonzero(xb[:, None, :] ^ bits[None, :, :], axis=2) <= hash_thresh)
        for r, c in zip(*np.nonzero(d)):
            if c > i + r:  # only forward pairs (upper triangle by index)
                union(paths[i + r], paths[c])
    clusters = collections.defaultdict(list)
    for p in paths:
        clusters[find(p)].append(p)
    return clusters


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--classes", default="backend/ml/street/configs/classes.yaml")
    ap.add_argument("--out", default="backend/ml/street/data/yolo")
    ap.add_argument("--hash-thresh", type=int, default=4)  # 64-bit phash hamming
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    cfg = yaml.safe_load(open(args.classes))
    mapping, cls_names = build_mapping(cfg)
    root = pathlib.Path("backend/ml/street/data")

    index = {}
    for ds in ROBOFLOW_DIRS:
        index.update(load_roboflow(root, ds, mapping))
    wm = root / "wheelmap"
    index.update(load_wheelmap(wm / "wm_annotations.xml", wm / "images", mapping))

    # exact dupes by content hash first (Roboflow exports may repeat images)
    images_raw = len(index)
    seen_md5 = {}
    for p in list(index.keys()):
        h = md5(p)
        if h in seen_md5:
            del index[p]
        else:
            seen_md5[h] = p

    clusters = dedupe(index, args.hash_thresh)
    keep = []
    dups = 0
    for _, members in clusters.items():
        keep.append(members[0])
        dups += len(members) - 1

    # instance counts per (src, target-class)
    inst = collections.defaultdict(collections.Counter)
    for p in index:
        for b in index[p]["boxes"]:
            inst[index[p]["src"]][b[0]] += 1

    # stratified split by anchor = rarest class present (post-dedupe, pre-split)
    cls_count = collections.Counter()
    for p in keep:
        for b in index[p]["boxes"]:
            cls_count[b[0]] += 1
    anchor = {}
    for p in keep:
        cls_present = sorted({b[0] for b in index[p]["boxes"]},
                             key=lambda c: cls_count[c])
        anchor[p] = cls_present[0] if cls_present else "none"

    rng = random.Random(args.seed)
    groups = collections.defaultdict(list)
    for p in keep:
        groups[anchor[p]].append(p)
    subset = {"train": [], "val": [], "test": []}
    for a, ps in sorted(groups.items()):
        rng.shuffle(ps)
        n = len(ps)
        n_tr = max(1, round(0.8 * n))
        n_v = max(1, round(0.1 * n)) if n > 2 else 0
        subset["train"].extend(ps[:n_tr])
        subset["val"].extend(ps[n_tr:n_tr + n_v])
        subset["test"].extend(ps[n_tr + n_v:])

    out = pathlib.Path(args.out)
    for sp in ("train", "val", "test"):
        (out / "images" / sp).mkdir(parents=True, exist_ok=True)
        (out / "labels" / sp).mkdir(parents=True, exist_ok=True)
        for p in subset[sp]:
            ext = p.suffix
            new = f"{p.stem[:32]}_{md5(p)[:10]}{ext}"
            shutil.copy(p, out / "images" / sp / new)
            lines = []
            im = index[p]
            for b in im["boxes"]:
                x1, y1, x2, y2 = b[1:]
                w, h = im["size"]
                cx = (x1 + x2) / 2 / w
                cy = (y1 + y2) / 2 / h
                bw = (x2 - x1) / w
                bh = (y2 - y1) / h
                lines.append(" ".join(str(v) for v in (
                    cls_names.index(b[0]), cx, cy, bw, bh)))
            # labels write alongside images
            (out / "labels" / sp / (pathlib.Path(new).stem + ".txt")).write_text(
                "\n".join(lines) + ("\n" if lines else ""))
    (out / "data.yaml").write_text(yaml.safe_dump(
        {"path": str(out.resolve()), "train": "images/train", "val": "images/val",
         "test": "images/test", "nc": len(cls_names), "names": cls_names,
         "names_orig": cls_names}, sort_keys=False))

    # reports
    train_inst = collections.Counter()
    for sp in ("train", "val", "test"):
        lp = out / "labels" / sp
        for f in lp.glob("*.txt"):
            for line in f.read_text().splitlines():
                train_inst[(sp, cls_names[int(line.split()[0])])] += 1
    report = {
        "images_total_raw": images_raw,
        "images_after_md5_actually": len(index),
        "images_after_phash": len(keep),
        "duplicates_removed": dups,
        "instances_per_class_total": dict(cls_count),
        "instances_per_class_split": {},
        "rare_classes_flagged": [c for c in cls_names if
                                 train_inst[("train", c)] < 150],
        "per_source_instances": {s: dict(v) for s, v in inst.items()},
        "split_counts": {sp: len(subset[sp]) for sp in subset},
    }
    for sp in ("train", "val", "test"):
        report["instances_per_class_split"][sp] = {
            c: train_inst[(sp, c)] for c in cls_names}
    (out / "dataset_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
