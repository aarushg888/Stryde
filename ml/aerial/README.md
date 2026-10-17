# ml/aerial — Tile2Net pedestrian-infrastructure layer

Produces the aerial-derived sidewalk / crosswalk / footpath network for the
accessibility-aware router, using Tile2Net **in inference-only mode** (no
training). Outputs feed the router as GeoJSON in EPSG:4326.

## Status

| Step | Status |
|---|---|
| Env verified (`generate` works; inference blocked on CUDA upstream) | done |
| MPS workaround runner (`tile2net_no_cuda.py`) — full pipeline runs locally, no NVIDIA GPU | done |
| Boston example (env validation) | done |
| Test-area (DC 0.08 km²) outputs + previews + schema notes | done |
| Demo-area (~1 km² DC, Logan Circle) GeoJSON + OSM metrics | done |
| Colab notebook (official CUDA path) | ready as fallback |

Results below come from the **MPS monkeypatch runner** (upstream supports
CUDA only); outputs were QA'd visually. Metrics are proxies, not accuracy.

## Repo layout

```
ml/aerial/
  SETUP.md                  tile2net setup, env facts, output schemas, eval notes
  tile2net_colab.ipynb      full GPU pipeline to run on Colab/Kaggle
  tile2net_no_cuda.py       monkeypatch runner: tile2net inference on MPS/CPU
  convert_tile2net_output.py  tile2net parquet -> contract GeoJSON (CPU, local)
  osm_metrics.py            OSM vs tile2net metrics (CPU, local)
  make_previews.py          folium HTML + PNG previews (CPU, local)
  requirements.txt          Python deps for the local scripts
  previews/                 generated preview maps (committed small artifacts only)
backend/tile2net/           tile2net clone (NOT committed; ignored)
backend/tile2net/output/    raw tile2net outputs (NOT committed; ignored)
```

## Demo / test areas

`DEMO_BBOX` was left unspecified; **default is a ~1 km² Logan Circle, DC
block area**:

* demo:  `[38.9182, -77.0380, 38.9092, -77.0270]` (lat, lon, lat, lon)
* test:  `[38.9162, -77.0340, 38.9142, -77.0310]` (~0.08 km² quick-validation box)

Replace the demo bbox in the notebook's config cell when the real one is set.
DC is a Tile2Net-supported region; Maryland is **not** supported.

## Reproduce (local, macOS MPS — used for the current outputs)

```bash
cd backend/tile2net && uv sync && cd ../..
uv venv ml/aerial/.venv && uv pip install --python ml/aerial/.venv/bin/python -r ml/aerial/requirements.txt

# demo area (~1 km² Logan Circle, DC; 400 tiles @512 px)
backend/tile2net/.venv/bin/python -m tile2net generate \
  --location "38.9182,-77.0380,38.9092,-77.0270" \
  --output backend/tile2net/output --name demo --dump_percent 0 --quiet
backend/tile2net/.venv/bin/python ml/aerial/tile2net_no_cuda.py \
  --city-info backend/tile2net/output/demo/tiles/demo_512_info.json --device mps

# contract files + metrics + previews
ml/aerial/.venv/bin/python ml/aerial/convert_tile2net_output.py \
  --project-dir backend/tile2net/output/demo --project-name demo \
  --inferred data/demo_area_inferred.geojson --polygons data/demo_area_polygons.geojson
ml/aerial/.venv/bin/python ml/aerial/osm_metrics.py \
  --inferred data/demo_area_inferred.geojson --bbox "38.9182,-77.0380,38.9092,-77.0270" \
  --region washington-dc --out metrics/aerial_vs_osm.json
ml/aerial/.venv/bin/python ml/aerial/make_previews.py \
  --inferred data/demo_area_inferred.geojson --polygons data/demo_area_polygons.geojson \
  --bbox "38.9182,-77.0380,38.9092,-77.0270" --name demo_area --out ml/aerial/previews
```

Runtime measured (Apple MPS, torch 2.14.1): segmentation 114 s for 400
512-px tiles (demo), 34.5 s for 64 tiles (test area). Generate is CPU-side
(< 1 min each). GPU used: Apple Silicon MPS via `tile2net_no_cuda.py` (no
NVIDIA CUDA available); the Colab notebook is the officially-supported
alternative.

## Reproduce (official path — Colab CUDA)

Open `tile2net_colab.ipynb` in Colab with a GPU runtime and run all cells.
Same outputs, same contract; useful as the upstream-validated control.

## Output contract (router handoff)

* `data/demo_area_inferred.geojson` — LineStrings, EPSG:4326,
  properties `{"source": "ml", "kind": "sidewalk"|"crosswalk"|"footpath",
  "confidence": null}`
  *Tile2Net does not expose per-feature softmax/confidence in its vector
  outputs, so `confidence` is null (documented; not invented).*
* `data/demo_area_polygons.geojson` — polygons, same properties.
* `metrics/aerial_vs_osm.json` — recall proxy (share of OSM sidewalk/
  crossing length within 3 m of tile2net centerlines), share of tile2net
  length with no OSM sidewalk/footway within 5 m (candidate new edges), and
  `in_training_cities` flag. Includes a caveat: OSM is incomplete and not
  ground truth.

## Results (demo area, as computed)

`metrics/aerial_vs_osm.json` (OSM footway ways within the bbox vs tile2net
centerlines, projected to UTM 18N):

| Metric | Value |
|---|---|
| OSM sidewalk/crossing length in bbox | 33.1 km (597 ways) |
| Tile2Net sidewalk/crosswalk length | 40.3 km (3,514 lines) |
| (a) OSM length within 3 m of tile2net — recall proxy | **82.4 %** |
| (b) Tile2Net length with no OSM sidewalk/footway within 5 m — candidate new edges | **34.1 %** (13.7 km) |
| (c) in_training_cities | true (DC — results optimistic by training domain) |

**Known failure modes observed (preview/segmentation review):**
* Mid-block gaps inside large building footprints / interior courtyards —
  model correctly finds no sidewalk there, but blocks partially occluded by
  tree cover in those interiors also miss segments.
* Gutters, parking-lot aisles, and private drives are sometimes labeled as
  sidewalk (the 34 % "new edge" share includes some of these false positives —
  treat unverified candidates as candidates, not facts).
* Crosswalk bundles at complex intersections sometimes z-fight/overdraw
  multiple parallel centerlines; router should collapse near-duplicates.
* DC is a training city — metrics above are optimistic vs. unseen regions.

To be re-checked on new areas before trusting (e.g., MD is unsupported by
tile2net imagery sources — do not run there).
