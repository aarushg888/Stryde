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
| Out-of-training NoVA eval (~1 km² Clarendon, Arlington VA) | done |
| v2 OSM metrics (tagged/untyped/crossing/roads + candidate-only new edges) | done |
| QA artifact: 25 sampled new edges per region + folium maps | done |
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
   connectivity.py           graph QA: components + crosswalk↔sidewalk linkage
   osm_metrics.py            OSM vs tile2net metrics v2 (CPU, local)
   make_previews.py          folium HTML + PNG previews (CPU, local)
   qa_sample.py              sample N random candidate new edges + folium map
   requirements.txt          Python deps for the local scripts
   previews/                 generated preview maps (committed small artifacts only)
   qa/                       sampled new-edge artifacts; *_all dumps not committed
backend/tile2net/           tile2net clone (NOT committed; ignored)
backend/tile2net/output/    raw tile2net outputs (NOT committed; ignored)
```

Related outputs in the repo: `data/{demo,test_area,nova}_area_*` (contract
GeoJSONs), `metrics/aerial_vs_osm*.json` (v2 metrics).

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

Runtime measured (Apple MPS, torch 2.14.1): segmentation 121 s for 400
512-px tiles (demo, regenerated run), 34.5 s for 64 tiles (test area),
47.8 s for 400 tiles @256 px (NoVA). Generate is CPU-side (< 2 min each).
GPU used: Apple Silicon MPS via `tile2net_no_cuda.py` (no NVIDIA CUDA
available); the Colab notebook is the officially-supported alternative.
NoVA generate notes: upstream's Virginia imagery host
(`gismaps.vdem.virginia.gov`) is dead (NXDOMAIN); the local clone points
`Virginia.server` at `vginmaps.vdem.virginia.gov/arcgis/rest/services/
VBMP_Imagery/MostRecentImagery_WGS/MapServer` (see SETUP.md before setting
up tile2net fresh).

## Reproduce (official path — Colab CUDA)

Open `tile2net_colab.ipynb` in Colab with a GPU runtime and run all cells.
Same outputs, same contract; useful as the upstream-validated control.

## Output contract (router handoff)

* `data/demo_area_inferred.geojson` — LineStrings, EPSG:4326,
  properties `{"source": "ml", "kind": "sidewalk"|"crosswalk"|"footpath"|"connector",
  "confidence": null}`
  *Tile2Net does not expose per-feature softmax/confidence in its vector
  outputs, so `confidence` is null (documented; not invented).
  `connector` lines are tile2net-generated sidewalk↔crosswalk stitching
  segments — not detected aerial features, but required for a routable
  graph. Near-duplicate parallel crosswalk centerlines are collapsed with
  `--collapse-crosswalks` (~1.5 m clusters, longest kept).*
* `data/demo_area_polygons.geojson` — polygons, same properties.
* `metrics/aerial_vs_osm.json` — recall proxy (share of OSM sidewalk/
  crossing length within 3 m of tile2net centerlines), share of tile2net
  length with no OSM sidewalk/footway within 5 m (candidate new edges), and
  `in_training_cities` flag. Includes a caveat: OSM is incomplete and not
  ground truth.

## Results (v2 metrics, as computed)

`metrics/aerial_vs_osm.json` and `metrics/aerial_vs_osm_nova.json` — OSM is
projected to UTM 18N. OSM count/length groups are **separate** (they are not
fully comparable to the v1 "merged" number):

| OSM group (within bbox) | DC (demo, Logan Circle) | NoVA (Clarendon, Arlington — **not** a training city) |
|---|---|---|
| `footway=sidewalk` ways (len / recall@3 m) | 338 ways, 29.7 km / **80.9 %** | 328 ways, 39.2 km / 61.1 % |
| untyped `footway` ways | 0 | 0 |
| `footway=crossing` ways (len / recall@3 m) | 259 ways, 3.4 km / **94.9 %** | 260 ways, 4.1 km / 74.3 % |
| roads tagged `sidewalk=left/right/both/yes` (len / share with tile2net sidewalk within 15 m) | 375 ways, 39.1 km / **61.3 %** | 406 ways, 39.4 km / 69.9 % |
| candidate new edges (tile2net len with no OSM sidewalk/footway within 5 m — **candidate only**) | **33.4 %** (14.2 km, 1,144 lines) | 20.0 % (6.7 km, 323 lines) |
| in_training_cities | true | false |

Reading: tile2net covers ~81 % of explicitly-mapped DC sidewalk length, drops
to ~61 % out-of-training (expected: DC is a training city, Arlington is not).
The 15 m road-adjacency check says over half of sidewalk-tagged road length
has a tile2net sidewalk nearby in both regions. "Candidate new edges" are
UNVERIFIED and include false positives (see below).

**Known failure modes (observed: demo/NoVA preview reviews + zoomed QA spot-
checks of 5 sampled new-edge clusters):**
* Parking aisles, gutters, and private alleys are labeled as sidewalk. Seen in
  NoVA: vertical candidate lines inside apartment parking strips off N
  Cleveland St; in DC: short candidate segments in the Naylor Court / 13th St
  NW parking courts and mid-block behind buildings.
* Park-interior candidates: segments inside 11th Street Park (NoVA) and park
  frontages near Rocky Run Park — some are real unmapped paths, some are tree/
  shadow artifacts; unverified either way.
* Alleys / interior-block walkways in DC (e.g., the dashed V St → church
  behind The Ellington) look plausible but are unverified against ground truth.
* Mid-block gaps inside large building footprints; interiors occluded by tree
  canopy lose segments.
* Crosswalk bundles at complex intersections z-fight/overdraw multiple
  parallel centerlines; `--collapse-crosswalks` trimmed 3 in the demo area and
  39 in NoVA, some remain near complex intersections.
* DC is a training city — DC metrics are optimistic; treat NoVA numbers as the
  better generalization estimate.

QA artifact: `ml/aerial/qa/new_edges_sample{,_map.html}` (25 random DC
candidates) and `new_edges_nova_sample{,_map.html}` (25 random NoVA
candidates); regenerate per-region with `qa_sample.py`. Full candidate dumps
(`*_all.geojson`) are reproducible via `osm_metrics.py --dump-new-edges` and
not committed.

Connectivity (see `connectivity.py`, `--json`): after the `connector` kind
fix, the demo graph's largest component grows 2.5 % → **48.7 %** and
crosswalk→sidewalk linkage 26.8 % → **99.7 %** (NoVA-style unrelated regions:
test area 3.8 % → 28.5 %). Verify with:

```bash
ml/aerial/.venv/bin/python ml/aerial/connectivity.py \
  --inferred data/demo_area_inferred.geojson --label demo --json
```

To be re-checked on new areas before trusting (e.g., MD is unsupported by
tile2net imagery sources — do not run there).
