# ml/aerial — Tile2Net pedestrian-infrastructure layer

Produces the aerial-derived sidewalk / crosswalk / footpath network for the
accessibility-aware router, using Tile2Net **in inference-only mode** (no
training). Outputs feed the router as GeoJSON in EPSG:4326.

## Status

| Step | Status |
|---|---|
| Local env verified (generate only — no CUDA GPU on this Mac) | done |
| Colab GPU notebook (example, test area, demo area) | ready — needs a Colab T4 run |
| Test-area outputs + previews | pending first notebook run |
| Demo-area GeoJSON + OSM metrics | pending first notebook run |

**No CUDA GPU exists on the dev machine** (`nvidia-smi` not found,
`torch.cuda.is_available() == False`, MPS only). Tile2Net local inference
errors out without CUDA. Everything below therefore runs in the Colab
notebook; postprocessing scripts run locally on CPU.

## Repo layout

```
ml/aerial/
  SETUP.md                  tile2net setup, env facts, output schemas, eval notes
  tile2net_colab.ipynb      full GPU pipeline to run on Colab/Kaggle
  convert_tile2net_output.py  tile2net parquet -> contract GeoJSON (CPU, local)
  osm_metrics.py            OSM vs tile2net metrics (CPU, local)
  make_previews.py          folium HTML + PNG previews (CPU, local)
  requirements.txt          Python deps for the local scripts
  previews/                 generated preview maps (committed small artifacts only)
backend/tile2net/           tile2net clone (NOT committed; ignored)
output/                     raw tile2net outputs (NOT committed; ignored)
```

## Demo / test areas

`DEMO_BBOX` was left unspecified; **default is a ~1 km² Logan Circle, DC
block area**:

* demo:  `[38.9182, -77.0380, 38.9092, -77.0270]` (lat, lon, lat, lon)
* test:  `[38.9162, -77.0340, 38.9142, -77.0310]` (~0.08 km² quick-validation box)

Replace the demo bbox in the notebook's config cell when the real one is set.
DC is a Tile2Net-supported region; Maryland is **not** supported.

## Reproduce (GPU step, Colab)

1. Upload/open `tile2net_colab.ipynb` in Colab → Runtime → Change runtime
   type → GPU (T4).
2. Run all cells. The notebook pins the tile2net commit, runs
   `examples/example.sh`'s Boston flow, the DC test area, then the demo area,
   exports the contract GeoJSON files, builds previews, and computes OSM
   metrics.
3. Download `tile2net_payload.zip`; drop its contents into the repo paths
   (`data/`, `ml/aerial/previews/`, `metrics/`).

## Reproduce (local CPU postprocessing)

```bash
uv venv ml/aerial/.venv
uv pip install --python ml/aerial/.venv/bin/python -r ml/aerial/requirements.txt

# convert tile2net parquet outputs to the contract GeoJSON
ml/aerial/.venv/bin/python ml/aerial/convert_tile2net_output.py \
  --project-dir backend/tile2net/output/demo --project-name demo \
  --inferred data/test_area_inferred.geojson \
  --polygons data/test_area_polygons.geojson

# OSM comparison for the demo bbox
metrics=/tmp/ignore; ml/aerial/.venv/bin/python ml/aerial/osm_metrics.py \
  --inferred data/test_area_inferred.geojson \
  --bbox "38.9162,-77.0340,38.9142,-77.0310" \
  --out /tmp/osm_test.json

# preview maps
ml/aerial/.venv/bin/python ml/aerial/make_previews.py \
  --inferred data/test_area_inferred.geojson \
  --polygons data/test_area_polygons.geojson \
  --bbox "38.9162,-77.0340,38.9142,-77.0310" \
  --out ml/aerial/previews
```

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

## Known failure modes

To be filled after the first GPU run; inspect
`ml/aerial/previews/` and segmentation PNGs for tree cover, parking lots,
private walkways.
