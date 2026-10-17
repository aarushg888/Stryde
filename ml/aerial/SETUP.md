# Tile2Net setup notes (ml/aerial)

Source of truth: the tile2net clone (`backend/tile2net`, pinned at commit
`c737a4e` at the time of writing — verify `git log -1` there), its
`README.md` and `BASICS.md`. All claims below were re-verified against the
clone before use.

## What the tool does (inference only — no training here)

1. `generate` (CPU) — creates the project structure, downloads imagery tiles
   for supported regions, stitches them, and writes a city_info JSON printed
   next to the log line `INFO       Dumping to ...`.
2. `inference` (CUDA GPU required) — runs the pretrained segmentation model,
   then writes polygon and centerline-network vector outputs in EPSG:4326.

## Verified environment facts

| Item | Status |
|---|---|
| Dev machine | macOS (darwin), no `nvidia-smi`, no CUDA; MPS available |
| Local inference (upstream path) | Blocked: `RuntimeError: Tile2Net inference requires a CUDA-capable PyTorch runtime` |
| Local inference (workaround) | **Works** via `ml/aerial/tile2net_no_cuda.py` (monkeypatches CUDA-only touchpoints to run the same pretrained model on MPS/CPU). Unofficial — results QA'd visually; Colab remains the officially-supported path |
| Local generate | Works on CPU (Boston example 96 tiles stitched, checkpoints cached at `~/Library/Caches/tile2net/weights`) |
| Local python | tile2net needs Python 3.11–3.14; clone venv uses Python 3.12 (uv, `uv sync`) |
| Pinned CUDA 11.7 / Py3.10.9 / torch 2.0.0 (old README) | Outdated: current clone needs Python 3.11–3.14 + any CUDA-compatible torch (verified torch 2.14.1; MPS run used the same env) |
| Install (local) | `cd backend/tile2net && uv sync` (or `conda create -n testenv python=3.11 && conda activate testenv && python -m pip install -e .` per README) |
| Install (Colab) | `pip install -e <tile2net dir>` on the preinstalled CUDA torch — covered by the notebook |

Measured local runtimes (MPS, torch 2.14.1, Apple Silicon):

| Area | tiles | tile px | generate | inference (MPS) |
|---|---|---|---|---|
| Boston example | 96 | 256 | CPU < 1 min | 34.5 s |
| DC test area (0.08 km²) | 64 | 512 | CPU < 1 min | 34.5 s |
| DC demo (~1 km²) | 400 | 512 | CPU < 2 min | 121 s (regenerated run) |
| NoVA Clarendon (~1 km², VA) | 400 | 256 | CPU < 2 min | 47.8 s |

## Local patch required for Virginia imagery

Upstream tile2net points at a dead host: `gismaps.vdem.virginia.gov`
(NXDOMAIN as of 2026-10). The local clone has an UNCOMMITTED one-line patch in
`backend/tile2net/src/tile2net/raster/source.py` (`Virginia.server`)
→ `https://vginmaps.vdem.virginia.gov/arcgis/rest/services/
VBMP_Imagery/MostRecentImagery_WGS/MapServer`. If you re-clone
tile2net, re-apply this patch or Virginia `generate` fails immediately;
DC works unpatched.

DC/VA sources auto-select 512 px base tiles; Boston uses 256 px — parser must
not assume a single size.

## Region support (BASICS.md)

| Region | Supported |
|---|---|
| DC (entire) | yes |
| Virginia (entire) | yes |
| Massachusetts, NYC, New Jersey, Oregon, Alameda County/LA, King County WA, Spring Hill TN | yes |
| **Maryland** | **not listed — unsupported** |

Do not run demo areas inside Maryland or other unsupported regions; imagery
would silently fall back or fail.

## Generate / inference usage

```bash
# generate (CPU; prints "INFO       Dumping to <city_info.json>")
python -m tile2net generate \
  --location "<lat,lon,lat,lon or address>" \
  --name "<project-name>" \
  --output "<output-dir>" \
  --dump_percent <0|parts|100>

# inference (GPU; reads the city_info JSON)
python -m tile2net inference \
  --local --eval test \
  --city_info "<city_info.json>" \
  --dump_percent <0|parts|100>
```

* bbox format: `[lat, lon, lat, lon]` — top-left then bottom-right (e.g.
  DC: `38.9071,-77.0374,38.8913,-77.0090`).
* `--dump_percent` controls how many segmentation PNG masks/previews get
  written; it does not affect polygon/network outputs. Use 0 for big areas to
  save disk.
* Weights download automatically on first inference run to
  `~/.cache/tile2net/weights` (env `TILE2NET_WEIGHTS_DIR` overrides). They are
  byte-size + SHA-256 verified against a pinned manifest; never commit them.
* Boston validation example: `bash backend/tile2net/examples/example.sh`
  (interactive: asks for an output dir; see the notebook for the headless
  equivalent).

## Output schema (validated against a real run on the demo area)

Everything under `<output-dir>/<project-name>/`:

```
tiles/{static,stitched}/...   raw + stitched imagery (never committed)
segmentation/<name>/512_19_4/ segmentation masks & previews (per --dump_percent)
polygons/<name>-polygons.parquet
  EPSG:4326, columns: geometry (Polygon), f_type in {sidewalk, crosswalk, road}
network/<name>-network.parquet
  EPSG:4326, columns: geometry (LineString), f_type in
  {sidewalk, crosswalk, sidewalk_connection, medians}
```

Observed in the demo run: network sidewalk=…/crosswalk=…/sidewalk_connection=…
(no `footpath` — this tile2net version does not emit footpath lines at the
network stage; polygons also contain `road`).

* `f_type` mapping in conversion (scripts + notebook):
  * `sidewalk -> sidewalk`, `crosswalk -> crosswalk`, `footpath -> footpath`
    (if emitted by future versions)
  * `sidewalk_connection -> connector` — kept in the router GeoJSON since it
    stitches sidewalks to crosswalks (used for graph connectivity, not a
    detected feature; CONTRACT CHANGE made in ml/aerial after the
    connectivity audit showed 607 components / 2.5% largest-share without it)
  * `road`, `medians` are excluded from the router
    GeoJSON (not detected walkable features; documented here, not silently dropped).
* No per-feature softmax/confidence survives into vector outputs;
  `confidence` is set to `null` in the contract files (never invented).

## Contract outputs (what the router consumes)

* `data/<area>_inferred.geojson` — LineStrings, EPSG:4326,
  properties `{"source": "ml", "kind": "sidewalk"|"crosswalk"|"footpath"|"connector", "confidence": null}`
* `data/<area>_polygons.geojson` — polygons, same properties
* `metrics/aerial_vs_osm.json` — OSM comparison (+ `in_training_cities` flag);
  OSM is incomplete and not ground truth.
* GeoJSON > ~50 MB goes to a GitHub Release instead of the repo.

## Local CPU/MPS pipeline (primary on this machine)

```bash
# one-time envs
cd backend/tile2net && uv sync && cd ../..
uv venv ml/aerial/.venv
uv pip install --python ml/aerial/.venv/bin/python -r ml/aerial/requirements.txt

# 1) generate (CPU) — prints "INFO       Dumping to <city_info.json>"
backend/tile2net/.venv/bin/python -m tile2net generate \
  --location "38.9182,-77.0380,38.9092,-77.0270" \
  --output backend/tile2net/output --name demo --dump_percent 0 --quiet

# 2) inference on MPS/CPU (monkeypatch runner; NOT upstream-supported)
backend/tile2net/.venv/bin/python ml/aerial/tile2net_no_cuda.py \
  --city-info backend/tile2net/output/demo/tiles/demo_512_info.json --device mps

# 3) contract GeoJSON (small area: also run the same for test_area)
ml/aerial/.venv/bin/python ml/aerial/convert_tile2net_output.py \
  --project-dir backend/tile2net/output/demo --project-name demo \
  --inferred data/demo_area_inferred.geojson \
  --polygons data/demo_area_polygons.geojson

# 4) OSM metrics for the demo bbox
ml/aerial/.venv/bin/python ml/aerial/osm_metrics.py \
  --inferred data/demo_area_inferred.geojson \
  --bbox "38.9182,-77.0380,38.9092,-77.0270" \
  --region washington-dc --out metrics/aerial_vs_osm.json

# 5) previews
ml/aerial/.venv/bin/python ml/aerial/make_previews.py \
  --inferred data/demo_area_inferred.geojson \
  --polygons data/demo_area_polygons.geojson \
  --bbox "38.9182,-77.0380,38.9092,-77.0270" \
  --name demo_area --out ml/aerial/previews

# 6) graph QA + sampled new-edge map (per area)
ml/aerial/.venv/bin/python ml/aerial/connectivity.py \
  --inferred data/demo_area_inferred.geojson --label demo --json
ml/aerial/.venv/bin/python ml/aerial/qa_sample.py \
  --new-edges ml/aerial/qa/new_edges_demo_all.geojson \
  --out-prefix ml/aerial/qa/new_edges_sample --n 25 --seed 7 \
  --bbox "38.9182,-77.0380,38.9092,-77.0270"
```

## Colab / Kaggle notebook

Self-contained: clones tile2net at the pinned commit, `pip install -e`,
checks CUDA, runs the Boston example, the DC test area, then the demo area,
exports contract GeoJSON, builds previews, computes OSM metrics, and zips
everything into `tile2net_payload.zip` for download. Runtime: ~15–25 min on
a Colab T4 including downloads; disk < 2 GB.
