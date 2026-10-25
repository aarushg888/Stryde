# Stryde — accessible pedestrian routing

Stryde plans walking routes the way people actually move: it searches the real
DC sidewalk graph under **three cost profiles** (Safest / Balanced / Shortest),
weights every unmarked crossing and open-road segment with **five years of DC
Open Data crash records**, and lets anyone **report street hazards** — backed
by a YOLO street-barrier detector (curb ramps, crosswalks, tactile paving,
stairs/steps, ramps) that verifies the photo before it enters the shared map.

One FastAPI backend serves the routing, the detector and the community hazard
layer. One Expo (React Native / web) app consumes it.

## Repo layout

```
backend/            FastAPI app  (main.py) + ml/street YOLO detector
data/osm/pickle/    pre-built DC walk graph (183k nodes as [lat,lng])
data/Crashes_in_DC.csv  2021–2026 DC crash records used for incident scoring
frontend/           Expo Router app: Map (routing) · Hazards · Preferences
scripts/run_backend.sh
```

## Quickstart (2 terminals)

**Backend** — Python 3.11+:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
pip install ultralytics            # detector engine (torch not in requirements)
./scripts/run_backend.sh           # uvicorn backend.main:app --host 0.0.0.0 --port 8100
curl localhost:8100/health         # -> {"ok":true,"weights":"detected",...}
```

All runtime data ships in-tree (`data/osm/pickle/*.pkl`, `best.pt`, crash CSV),
so a fresh clone works offline — no Overpass calls, no model training.

**Frontend** — Node 18+:

```bash
cd frontend
npm install
npx expo start --web     # http://localhost:8081  (web)
# npx expo start         # iOS/Android dev flow (map uses react-native-maps)
```

The browser hits `http://localhost:8100` automatically; phones on the same
Wi‑Fi resolve to the Metro host instead. Override with
`EXPO_PUBLIC_API_URL=http://<ip>:8100`.

## Try it

1. Type a start (e.g. **Logan Circle**) and a destination (e.g. **Dupont
   Circle**) — address search uses PlaceKit when
   `EXPO_PUBLIC_PLACEKIT_KEY` is set, Nominatim/OSM otherwise.
2. **Find Routes** — three color-coded routes appear on the Leaflet map
   (web) / react-native-maps (native).
3. **View Alternate Routes** to swap profiles, or open **Hazards** to detect
   and report a barrier, or **Preferences** to pick wheelchair mode and
   safety flags (persisted server-side via `/preferences`, consulted by the
   rules-based `/chat` assistant).

## API surface

| Route | Purpose |
| --- | --- |
| `GET /health` | graph + detector weight status, coverage list |
| `GET /search?start=&goal=` | 3 A* routes, snapped to nearest walk node |
| `GET /coverage?area=` | demo/NoVA/test footprints |
| `POST /detect` | YOLO barrier classes + confidence for an uploaded photo |
| `POST /report` | community hazard (type, lat/lng, description, photo) |
| `GET/POST /preferences` | persisted routing-mode + safety flags |
| `POST /chat` | rules-based route assistant (offline, deterministic) |

## Testing / typecheck

```bash
cd frontend && npx tsc --noEmit && npx expo lint
```

## Data attribution

- Sidewalk graph: OpenStreetMap via osmnx (tiles © OpenStreetMap contributors).
- Crash layer: DC Open Data “Crashes in DC” (2021–2026), columns used for
  scoring only.
- Detector: custom YOLO11s model trained on community street photos —
  sample detection shipped at `backend/ml/street/samples/demo_curb_ramp.jpg`.
