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
2. **Find Routes** — three color-coded routes render on the satellite web
   map (Esri imagery + labels via Leaflet) or Apple Maps (native
   react-native-maps). Both are **locked to Washington, DC**; a side panel
   (Route settings) lets you re-score routes against Preferences without
   leaving the map, and community hazards show up as emoji badges on the map.
3. **View Alternate Routes** to swap profiles, or open **Hazards** to detect
   and report a barrier, or **Preferences** to pick wheelchair mode and
   safety flags (persisted server-side via `/preferences`, consulted by the
   rules-based `/chat` assistant).

## API surface

| Route | Purpose |
| --- | --- |
| `GET /health` | graph + detector weight status, coverage list |
| `GET /search?start=&goal=` | 3 A* routes, snapped to nearest walk node; accepts `mode` (standard/wheelchair) + the four safety flags as query params (used by the map's "Update Route" button); reported hazards raise edge costs within 30 m |
| `GET /coverage?area=` | demo/NoVA/test footprints |
| `POST /detect` | YOLO barrier classes + confidence for an uploaded photo |
| `POST /report` | community hazard (type, lat/lng, description, photo) |
| `GET /hazards` | recent community hazard reports (newest first) |
| `GET/POST /preferences` | persisted routing-mode + safety flags |
| `POST /chat` | rules-based route assistant (offline, deterministic) |

## Deploy

**Rule of thumb:** the web frontend is static — host it anywhere (Vercel is
free). The backend is heavy (torch + 183k-node graph pickles in RAM ~1.5 GB),
so it needs a paid- tier host or a small VM, not a free 512 MB tier.

### Web frontend on Vercel

1. Push the repo, then in Vercel **Add New → Project → Import** the GitHub repo.
2. Set **Root Directory** = `frontend`. Vercel auto-detects Expo web
   (`npx expo export --platform web` → `dist/`).
3. Env var (Production + Preview): `EXPO_PUBLIC_API_URL = https://<backend-host>`
   (leave empty only if you proxy /api in front of the backend).
4. Deploy. CLI alternative:

```bash
npm i -g vercel
vercel link --project stryde
vercel env add EXPO_PUBLIC_API_URL production     # paste the backend URL
vercel --prod
```

Sanity-check locally first: `cd frontend && npx expo export --platform web && npx serve dist`.

### Backend on Render (or any VM)

Render → **New → Web Service** from the repo:

- Build command: `pip install -r backend/requirements.txt`
- Start command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` (repo root)
- Instance size: **1 GB+** (free 512 MB OOMs while loading the graph). Pickles
  load on boot, so expect a ~40 s first request — keep the service warm or
  ping `/health` from a cron.

Any Linux box works identically:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
PORT=8100 .venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8100
# wrap in a systemd unit (Restart=on-failure) for persistence
```

Then set Vercel's `EXPO_PUBLIC_API_URL=https://<backend-host>` and re-deploy.
CORS is wide open (`allow-origins: *`), so no extra config is needed. The
mobile app (Expo Go) must point at the same URL via the env var or a LAN IP.

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
