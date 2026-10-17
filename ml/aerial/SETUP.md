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
| Dev machine | macOS (darwin), no `nvidia-smi`, `torch.cuda.is_available() = False`, MPS present but **not** used by tile2net |
| Local inference | Blocked: `RuntimeError: Tile2Net inference requires a CUDA-capable PyTorch runtime` |
| Local generate | Works on CPU (verified: Boston example 96 tiles stitched, checkpoints downloaded to `~/Library/Caches/tile2net/weights`) |
| Local python | tile2net needs Python 3.11–3.14; clone venv uses Python 3.12 (uv, `uv sync`) |
| Pinned CUDA 11.7 / Py3.10.9 / torch 2.0.0 (old README) | Outdated: current clone needs Python 3.11–3.14 + any CUDA-compatible torch (verified torch 2.14.1 imports fine; no old-version pin) |
| Install (local) | `cd backend/tile2net && uv sync` (or `conda create -n testenv python=3.11 && conda activate testenv && python -m pip install -e .` per README) |
| Install (Colab) | `pip install -e <tile2net dir>` on the preinstalled CUDA torch — covered by the notebook |

**Blocker + alternatives (reported):** no local CUDA GPU.

1. Run `ml/aerial/tile2net_colab.ipynb` in Colab/Kaggle (recommended, self-contained).
2. Run the same commands on any CUDA Linux box (cluster node, Kaggle T4/P100, AWS/gcp GPU VM) using the `python -m tile2net generate | inference` flow documented in the notebook.

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

## Output schema (validated against source, not just docs)

Everything under `<output-dir>/<project-name>/`:

```
tiles/{static,stitched}/...   raw + stitched imagery (never committed)
segmentation/<name>/256_19_4/ segmentation masks & previews (per --dump_percent)
polygons/<name>-polygons.parquet
  EPSG:4326, columns: geometry (Polygon), f_type in {sidewalk, crosswalk, road}
network/<name>-network.parquet
  EPSG:4326, columns: geometry (LineString), f_type in
  {sidewalk, crosswalk, sidewalk_connection, medians}
```

* `f_type` mapping in conversion (scripts + notebook):
  * `sidewalk -> sidewalk`, `crosswalk -> crosswalk`, `footpath -> footpath`
    (if emitted by future versions)
  * `road`, `sidewalk_connection`, `medians` are excluded from the router
    GeoJSON (not detected features; documented here, not silently dropped).
* No per-feature softmax/confidence survives into vector outputs;
  `confidence` is set to `null` in the contract files (never invented).

## Contract outputs (what the router consumes)

* `data/<area>_inferred.geojson` — LineStrings, EPSG:4326,
  properties `{"source": "ml", "kind": ..., "confidence": null}`
* `data/<area>_polygons.geojson` — polygons, same properties
* `metrics/aerial_vs_osm.json` — OSM comparison (+ `in_training_cities` flag);
  OSM is incomplete and not ground truth.
* GeoJSON > ~50 MB goes to a GitHub Release instead of the repo.

## Local CPU postprocessing env

```bash
uv venv ml/aerial/.venv
uv pip install --python ml/aerial/.venv/bin/python -r ml/aerial/requirements.txt
```

Scripts (all ESPG:4326 in, EPSG:4326 out):

* `convert_tile2net_output.py` — parquet → contract GeoJSON
* `osm_metrics.py` — OSM sidewalk/crossing vs tile2net metrics
* `make_previews.py` — folium HTML + matplotlib PNG previews

## Colab / Kaggle notebook

Self-contained: clones tile2net at the pinned commit, `pip install -e`,
checks CUDA, runs the Boston example, the DC test area, then the demo area,
exports contract GeoJSON, builds previews, computes OSM metrics, and zips
everything into `tile2net_payload.zip` for download. Runtime: ~15–25 min on
a Colab T4 including downloads; disk < 2 GB.
