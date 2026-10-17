# ml/street datasets (barrier detector)

All four datasets are public (CC BY 4.0) and merge into the 5-class target set
(`configs/classes.yaml`): `curb_ramp, crosswalk, stairs_steps, tactile_paving, ramp`.
Raw dataset folders/zips are NOT committed (`backend/ml/street/data/` is
gitignored: raw zips >50 MB, GitHub blocks).

| dataset | source | getting the data | images | license |
|---|---|---|---|---|
| `sidewalksidewalk_v10` | Roboflow Universe `sidewalkdetect/-sidewalk` **v10** ("2025-07-17 1:28am", 4099 imgs) | API `GET /sidewalkdetect/-sidewalk/10/yolov8?download=true` (key from `backend/ml/street/.env`) → zip 350 MB | 2860 train / 825 valid / 414 test | CC BY 4.0 (stated) |
| `logan_intersections_v1` | Roboflow Universe `experiments-ypxgq/logan-intersections` v1 (DC Logan Circle area) | API same way → zip 109 MB | 1159 / 314 / 155 | CC BY 4.0 (stated) |
| `combined_proj_v2` | Roboflow Universe `computervision-k6ypi/combined-proj` v2 | API same way → zip 165 MB | 1713 / 469 / 253 | CC BY 4.0 (stated) |
| `wheelmap` | Zenodo record **6382090** "Image Dataset of Accessibility Barriers" (DOI 10.5281/zenodo.6382090, CVAT XML + 5538 jpgs in one 7.97 GB zip) | local zip listed the central directory over ranged HTTP; only step/stair/ramp-annotated images extracted (grab_bar-only images dropped), CVAT XML → YOLO per-image labels | 3349 annotated images kept (3564 step / 1492 stair / 143 ramp boxes) | CC BY 4.0 (stated) |

## Notes / deviations from the requested sources

* The task named `sidewalkdetect/-sidewalk` (→ used v10 as-is), but ALSO
  `experiments-ypxgq/loganintersection2` and `computervision-k6ypi/test-b4zho` —
  **both of those projects have 0 exportable versions** (checked via API:
  `versions: 0`, no version can be exported). Instead the workspace siblings
  with real exports were used: `logan-intersections` v1 (1628 imgs, bumps the
  same scene family: textured/non-textured curb ramp, cross walk) and
  `combined-proj` v2 (2435 imgs, bumps cross walk / curb ramp / textured paving).
  Substitution documented; no data was fabricated.
* Export settings: YOLOv8 format, NO augmentation (checked version JSON:
  `augmentation: {}` for all three; preprocess = auto-orient + 640×640 stretch).
* Zenodo annotation format: CVAT XML 1.1 -> `<image name width height><box
  label xtl ytl xbr ybr><attribute name height/type/...>value</attribute></box>`.
  label counts: step 3564 (attrs height {<3, 3-7, >7cm}, type {doorstep, curb,
  other}), stair 1492 (attr number_of_steps), ramp 143 (attr width), grab_bar
  922 (dropped — router doesn't use them).
* Class mapping (details in `configs/classes.yaml`):
  - `curb ramp` / `textured curb ramp` / `non textured curb ramp` → `curb_ramp`
  - `zebra crossing` / `cross walk` / `0 cross walk` → `crosswalk`
  - `blind tracks` / `4 textured paving` → `tactile_paving`
  - Zenodo `step` + `stair` → `stairs_steps`; Zenodo `ramp` → `ramp`
    (NOT curb_ramp, per spec)
  - dropped: `pedestrian sign`, `stop sign`, `traffic light post`, `button`,
    `signal`, Zenodo `grab_bar`, and the malformed `\` class from combined-proj v2
* License for every merged source: CC BY 4.0 (Roboflow metadata + Zenodo).

## Build (B1)

```bash
backend/tile2net/.venv/bin/python backend/ml/street/scripts/build_dataset.py \
    --classes backend/ml/street/configs/classes.yaml \
    --out backend/ml/street/data/yolo
```

Pipeline: read all 4 raw datasets → class map → exact dedupe (MD5) →
perceptual-hash dedupe (phash 64-bit, hamming ≤ 4) **before any split** →
80/10/10 stratified by anchor class (rarest class in image) →
`backend/ml/street/data/yolo/{train,val,test}` + `data.yaml` +
`dataset_report.json` (per-class instance counts, splits, flagged rare classes
below 150 train instances).
