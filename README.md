# Stryde an accessible pedestrian routing app

Stryde routes pedestrians — especially wheelchair and low-visibility users —
using **two ML layers** over real data:

- **Aerial layer** (shipped): Tile2Net visual inference of sidewalks/crosswalks
  over orthoimagery + OSM fusion (Logan Circle DC, test area, NoVA Clarendon).
- **Street layer** (warming up): YOLO11s street-barrier detector over
  participant photos (curb ramps, crosswalks, tactile paving, stairs/steps,
  ramps).

One backend serves both; one Expo app (React Native) consumes it.

## Quickstart

### 1. Backend (FastAPI, one process)

```bash
./scripts/run_backend.sh                     # FastAPI on :8100 (replaces the line below)
# backend/tile2net/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8100
# health:      curl http://localhost:8100/health
# route:       curl "http://localhost:8100/search?start=n0&goal=n100"
#              (start/goal accept graph node ids OR "lat,lng")
# coverage:    curl "http://localhost:8100/coverage?area=demo"
# detect:      curl -F file=@photo.jpg -F conf=0.25 http://localhost:8100/detect
```

`/search` runs A* over the real router graph (3 535 nodes / 3 401 tubes built
from aerial inference) and returns node ids, cost in meters, a
`geometry` lat/lng polyline, snap distances and — for "lat,lng" inputs —
`straight_m` (crow-flies) and `ratio` (route ÷ straight line). Nearest nodes
on both ends are tried in pairs until a connected route exists, and the
polyline starts/ends at the exact coordinates you entered. `/detect` 503s
with a clear message until the detector weights finish training (section 3).

Smoke tests (zero dependencies, spawns its own uvicorn on :8199):

```bash
backend/tile2net/.venv/bin/python backend/tests/test_api.py   # 13 checks
```

### 2. Frontend (Expo app)

```bash
cd frontend && npm install && npx expo start
```

- Web/iOS-sim: works with the backend on `localhost:8100`.
- Phone: same Wi-Fi, then `EXPO_PUBLIC_API_URL=http://<mac-lan-ip>:8100 npx expo start`.
- Screens: **Home** (map + safer-route search, draws the real route polyline),
  **Report a Hazard** (attach a photo — analyzed by `/detect`; shows
  per-class counts on submit), **Explore** (route options UI), **Preferences**.

### 3. Finish detector training (weights pending)

Current status: YOLO11s 5-class detector, dataset built (9 993 unique images,
stratified 80/10/10, ramp oversampled), MPS probe 774 s/epoch → **Colab
run** required:

1. Open `backend/ml/street/train_colab.ipynb` in Google Colab, GPU runtime.
2. Run all cells (~1.5–3 h on T4); it fetches datasets, builds, trains,
   evaluates val+test into `street.json`, exports ONNX, and downloads
   `weights_payload.zip`.
3. `unzip weights_payload.zip -d .` at the repo root — files land in
   `backend/ml/street/{weights,metrics,samples}` — then restart the backend.

Until then `/detect` returns HTTP 503 *"warming up"*, and the app still
lets you file the hazard report (AI step is optional).

## Repo map

| Path | What |
|---|---|
| `backend/main.py` | MVP API: A* `/search` (+ toy-graph fallback), `/coverage`, `/detect`, `/health`, CORS |
| `backend/graph.py` | Tile2Net generate+inference runner (e.g. Boston Common) |
| `backend/ml/aerial/` | tile2net conversion, OSM fusion metrics, connectivity healing, QA, router-graph builder; details in `backend/ml/aerial/README.md` |
| `backend/ml/street/` | dataset build (Roboflow v10/v1/v2 + Zenodo 6382090), training/eval/detect scripts, Colab notebook; details in `backend/ml/street/DATASETS.md` |
| `backend/ml/FINAL_REPORT.md` | full ML report: contract change, metrics, decision log |
| `data/router_graph/` | router handoff: `graphs[0]`=adjacency, `graphs[1]`=(n1,n2)→meters, `meta.node_latlng` |
| `data/*_area_inferred.geojson` | aerial inference contract outputs (demo/test/nova) |
| `frontend/src/app/` | Expo Router screens |

## Notes & caveats

- **Centerline contract changed**: kinds are now
  `sidewalk|crosswalk|footpath|connector` (no `sidewalk_connection`).
- **Repo-local tile2net**: `backend/tile2net` is tracked (203 source files)
  with the Virginia imagery-server patch applied in
  `backend/tile2net/src/tile2net/raster/source.py`; local `.venv`/outputs stay
  ignored.
- **Router graph connectivity**: 220 components (largest 1 622 nodes).
  `/search` returns 404 with guidance when start/goal are in different
  components; see `backend/ml/aerial/connectivity.py` for healing stats.
- Known UI issues inherited from the merged UI branch: pre-existing TS errors
  in `explore.tsx`, `app-tabs.tsx`, css-module import (cosmetric at runtime).
- Branch history: the earlier `ML-v1` remote was rewritten with
  backends/`idk` commits; the complete ML lineage is preserved on
  `origin/ml-v1-archive` and merged into `main`.
