# ML Final Report — Accessibility Layers (branch `ML-v1`)

Two independent ML layers served over FastAPI, both feeding an accessibility
router:

1. **Aerial layer** (Phase A, complete): Tile2Net visual inference of
   sidewalks/crosswalks over orthoimagery, fused with OSM tags, producing
   centerline + area polygons and connectivity metrics.
2. **Street layer** (Phase B/C, code complete, weights pending Colab run):
   YOLO11s object detector over street-level/participant images for
   ground-truth barrier detection (`curb_ramp`, `crosswalk`, `stairs_steps`,
   `tactile_paving`, `ramp`).

---

## Contract change (breaking; consumers must update)

Centerline `kind` decoded values are now `sidewalk | crosswalk | footpath |
connector` — the legacy tiled `sidewalk_connection` value became `connector`
(Tile2Net SLIDE-CNN no longer emits the split tag).
**Consumers (routing/graph ingestion) must not branch on `sidewalk_connection`.**

---

## Phase A — aerial layer (shipped)

### Pipeline
OSM tag munging → Tile2Net inference (512 px tiles) → tiled-output conversion
to contract GeoJSONs + OSM overlay GeoJSON + metrics → connectivity healing →
QA previews/zoom spot-checks → v2 re-scores with `candidates_hll_flatten`.

### Connectivity (before → after healing)
| Area | largest-component completion | CW→SW linkage |
|---|---|---|
| Demo Logan Circle (DC) | 2.46 % → **48.65 %** | 99.7 % |
| Test area (DC) | 3.78 % → **28.53 %** | — |

(NoVA connectivity: not measured; NoVA is used for OSM-agreement
generalization metrics below.)

### OSM agreement (v2 semantics: candidates include `inferred` sidewalks)
| Area | tagged centerline recall ≤ 2 m | crossing recall ≤ 2 m | road adherence ≤ 15 m | width-candidates of tagged length |
|---|---|---|---|---|
| Demo (DC) | 0.8094 | 0.9494 | 0.6125 | 33.4 % (1 144 lines) |
| NoVA (generalization) | 0.6108 | 0.7433 | 0.6989 | 20.0 % (323 lines) |

DC crosswalk z-fighting: excess `crosswalk` candidates dropped via best-supplement
collapse (demo: 3, nova: 39).

### Known failure modes (from QA zoom spot-checks)
- Parking aisles and parking lots inferred as sidewalks (N Cleveland St
  apartments; Naylor Court, DC).
- Park interiors carrying inferred sidewalks (11th Street Park; Rocky Run).
- Interior-block alleys behind rowhouses (V St behind The Ellington).
- Mid-block gaps under tree canopy; genuinely LD segments caught by healing.
- Residual z-fight crosswalk fractions dropped by collapse.
- DC bias: Tile2Net was trained on DC imagery → NoVA recall lower (expected;
  documented rather than hidden).

### Local patch (documented in `backend/ml/aerial/SETUP.md`)
`backend/tile2net/src/tile2net/raster/source.py`: `Virginia.server` →
`vginmaps.vdem.virginia.gov/.../VBMP_Imagery/MostRecentImagery_WGS/MapServer`
(VBMP Most Recent Imagery; the stock VGIN WMS endpoint was dead 404).

### Router-graph handoff (teammate contract)
`backend/ml/aerial/build_router_graph.py` → `data/router_graph/{adjacency.json,
tubes.json,meta.json}`:

```python
from backend.ml.aerial.router_graph import load as load_graph
graphs, meta = load_graph("data/router_graph")
graphs[0]  # {node: [neighbor, ...]}
graphs[1]  # {(n1, n2): distance_meters}
# find start/end nodes in graphs[0]; edges/weights in graphs[1]
```

Demo graph: **3 535 nodes / 3 401 tubes**, 743 closed loops skipped, 0 isolated
nodes, 2 m snap tolerance, EPSG 32600+zone (hemisphere fix: was returning a
southern-hemisphere zone for US longitudes).

---

## Phase B — street detector

### Machine rule (applied)
Probe run: YOLO11s @ imgsz 640, 1 epoch on Apple MPS = **774 s** (> ~240 s) ⇒
**Colab path**: `backend/ml/street/train_colab.ipynb` (self-contained: dataset
fetch + build + train + held-out eval + samples + ONNX export + payload zip,
roboflow key via Colab Secrets). Drop `weights_payload.zip` contents into
`backend/ml/street/{weights,metrics,samples}`.

### Dataset (4 sources → unified YOLO)
| Source | Version used | License | Images | Notes |
|---|---|---|---|---|
| Roboflow `sidewalkdetect/-sidewalk` | v10 (NO aug) | CC BY 4.0 | 4 099 | blind tracks / curb ramp / zebra crossing |
| Roboflow `experiments-ypxgq/logan-intersections` | v1 | CC BY 4.0 | 1 628 | **substituted**: `loganintersection2` has 0 exported versions |
| Roboflow `computervision-k6ypi/combined-proj` | v2 | CC BY 4.0 | 2 435 | **substituted**: `test-b4zho` has 0 exported versions |
| Zenodo 6382090 (Wheelmap WM barriers, CVAT XML) | — | CC BY 4.0 | 3 349 | step/stair→`stairs_steps`, ramp kept, grab_bar/dropped-without-box images excluded; 7.97 GB zip fetched subset via ranged HTTP |

Build: **11 511 raw → 9 993 unique** (1 518 near-duplicates removed by MD5 +
pHash, hamming ≤ 4, dedupe *before* splitting) → stratified 80/10/10 =
**7 994 / 1 000 / 999** (+165 ramp images duplicated for rare-class
oversampling; `rare_classes_flagged = ["ramp"]`, 115 train instances).
Instances: curb_ramp 5 491 · crosswalk 4 504 · tactile_paving 1 803 ·
stairs_steps 5 056 · ramp 143.

Full per-source/split audit: `backend/ml/street/reports/dataset_report.json`.
Source/version/license walkthrough: `backend/ml/street/DATASETS.md`.

### Decisions logged
- **Substitutions** for the two named Roboflow projects with zero exported
  versions (workspace siblings, kept class space consistent).
- **Zip64 fix**: 1 525 of 3 349 Wheelmap members have central-directory
  offsets = 0xFFFFFFFF; true offsets recovered from the zip64 extra field
  (eid 0x0001) or fetches silently land on garbage. All 3 349 fetched
  (final pass, 0 fails).
- Dropped classes: sign posts, traffic lights, buttons, signals, malformed
  `\` label, grab_bar (in Wheelmap only, no sidewalk relevance for routing).
- No augmentation-training versions used; Roboflow preprocessing was the
  stock auto-orient + 640×640 stretch that the export applies server-side —
  we treat those images as source data and let Ultralytics handle train-time
  augmentation.
- Eval discipline: val for all decisions, **test touched once** for the final
  report.

---

## Phase C — serving

- `backend/ml/serve.py`: FastAPI — `POST /detect` (multipart image, `conf`
  form field default 0.25, 10 MB cap), `GET /health`. Weights go to
  `backend/ml/street/weights/best.pt` (committed once produced, ~19 MB —
  under the 50 MB repo limit).
- `backend/ml/street/scripts/detector.py`: `detect(image_bytes, conf)` →
  `[{"class", "confidence", "bbox": [x1,y1,x2,y2]}]`, plus CLI `detect` and
  `export-onnx`.
- `backend/ml/street/scripts/eval_detector.py`: writes
  `backend/ml/street/metrics/street.json` (val + test, per-class P/R/mAP).
- API key hygiene: `ROBOFLOW_API_KEY` lives in gitignored
  `backend/ml/street/.env`; never printed/committed; Colab reads it from
  Colab Secrets or a masked `getpass` prompt.

## Pending (single manual step)
Run `backend/ml/street/train_colab.ipynb` on a GPU runtime, unzip
`weights_payload.zip` into the four repo paths it maps to, then:
```
backend/tile2net/.venv/bin/python backend/ml/street/scripts/eval_detector.py --verify   # re-verify street.json sanity
backend/tile2net/.venv/bin/python -m backend.ml.serve --port 8000                        # serve
```
No re-tuning on test after that point.
