# Run Stryde (web + backend)

Two processes, two terminals. Both are started from the repo root.

## 0. One-time setup

```bash
# backend deps (Python 3.11+)
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
pip install ultralytics        # detector engine (torch, kept out of requirements.txt)

# frontend deps (Node 18+)
cd frontend && npm install && cd ..
```

Everything else (sidewalk graph, crash data, YOLO weights) is already in the
repo, so no downloads are needed at runtime.

## 1. Backend — port 8100

```bash
./scripts/run_backend.sh
```

or manually:

```bash
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8100
```

Check it's alive:

```bash
curl localhost:8100/health        # {"ok":true,"weights":"detected",...}
open http://localhost:8100/docs   # interactive API docs
```

## 2. Web frontend — port 8081

```bash
cd frontend
npx expo start --web --port 8081
```

then open **http://localhost:8081** (Chrome shows a QR/others in terminal).

The browser talks to `http://localhost:8100` automatically. On a phone over
the same Wi-Fi the app resolves the API to the machine running Metro; force
an address with:

```bash
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:8100 npx expo start --web
```

## 3. 60-second demo path

1. Type **Logan Circle** into `Enter start...`, pick a suggestion.
2. Type **Dupont Circle** into the destination box, pick a suggestion.
3. **Find Routes** → three colored routes draw on the map
   (green = safest, yellow = balanced, red = shortest).
4. **View Alternate Routes** to switch profiles.
5. Optional tabs: **Hazards** (detect/report a barrier), **Preferences**
   (wheelchair mode + safety flags, saved via the backend).

## 4. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Map tab empty / web 500 | restart web server with `--clear`: `npx expo start --web --clear` |
| "Cannot reach the backend at …" toast | backend not running, or port blocked — check `curl localhost:8100/health` |
| Address search returns nothing | Nominatim fallback rate-limited (1 req/s); wait a second, or set `EXPO_PUBLIC_PLACEKIT_KEY` |
| Port already in use | `lsof -ti :8100 -sTCP:LISTEN | xargs kill` (or :8081 for web) |
| Detector 503 on /detect | `pip install ultralytics` and confirm `backend/ml/street/weights/best.pt` exists |

## 5. Checks before submitting

```bash
cd frontend && npx tsc --noEmit && npx expo lint   # both must be green
```
