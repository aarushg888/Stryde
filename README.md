# Stryde — accessible pedestrian routing

Stryde plans walking routes the way people actually move: it searches the real
DC sidewalk graph under **three cost profiles** (Safest / Balanced / Shortest),
weights every unmarked crossing and open-road segment with **five years of DC
Open Data crash records**, and lets anyone **report street hazards** — backed
by a YOLO street-barrier detector (curb ramps, crosswalks, tactile paving,
stairs/steps, ramps) that verifies the photo before it enters the shared map.

## Repo layout

```
backend/            FastAPI app (main.py) + ml/street YOLO detector
data/osm/pickle/    pre-built DC walk graph (183k nodes as [lat,lng])
data/Crashes_in_DC.csv  2021–2026 DC crash records used for incident scoring
frontend/           Expo Router app: Map · Hazards · Preferences
scripts/run_backend.sh
```

## Run it locally

**Backend** — Python 3.11+, first time only:

```bash
cd stryde
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
pip install ultralytics            # detector engine (torch not in requirements)
```

Then every time (from the repo root, with the venv active):

```bash
./scripts/run_backend.sh           # uvicorn backend.main:app on http://localhost:8100
curl localhost:8100/health         # -> {"ok":true,"weights":"detected",...}
```

All runtime data ships in-tree (`data/osm/pickle/*.pkl`, `best.pt`, crash CSV),
so a fresh clone works offline — no Overpass calls, no model training.

**Web app** — Node 18+, second terminal:

```bash
cd frontend
npm install
EXPO_PUBLIC_API_URL=http://localhost:8100 npx expo start --web
# opens http://localhost:8081
```

**Mobile app (Expo Go)** — same machine as the backend, phone on the same Wi-Fi:

```bash
cd frontend
npm install
EXPO_PUBLIC_API_URL=http://<your-mac-lan-ip>:8100 npx expo start
# install "Expo Go" from the App Store / Play Store, then scan the QR code
# in the terminal output. The map uses Apple Maps (iOS) natively.
```

Find your Mac's LAN IP with `ipconfig getifaddr en0` (usually `192.168.x.x`).

## Try it

1. Type a start and a destination (or tap the map-pin / GPS icons on either field):
   - **Logan Circle → Dupont Circle** — short hop with crossing choices
   - **Union Station → Georgetown Waterfront** — long riverside walk
   - **Smithsonian Metro → U Street** — north-south through Downtown
2. **Find Routes** — three color-coded routes render on the satellite map
   (Esri imagery via Leaflet on web, Apple Maps on native). Both are locked
   to Washington, DC; a floating drawer (Route / Hazards / Preferences) sits
   over the map: switch settings, then **Update Route** re-scores without
   leaving the map, and community hazards show up as icon badges the Safest
   route detours around.
3. Open **Hazards** to detect and report a barrier (photo → YOLO check →
   submitted), or **Preferences** to pick wheelchair mode and safety flags —
   persisted on-device and applied to every new search.

## Testing / typecheck

```bash
cd frontend && npx tsc --noEmit && npx expo lint
```

## Data attribution

- Sidewalk graph: OpenStreetMap via osmnx (tiles © OpenStreetMap contributors).
- Web basemap: Esri World Imagery + labels (© Esri, Maxar, Earthstar Geographics).
- Crash layer: DC Open Data "Crashes in DC" (2021–2026), columns used for
  scoring only.
- Detector: custom YOLO11s model trained on community street photos —
  sample detection shipped at `backend/ml/street/samples/demo_curb_ramp.jpg`.
