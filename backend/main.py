"""Stryde MVP API — routing + accessibility layers in one service.

Merges the router team's A* /search (start/end nodes over a graph of
[adjacency, tube-weights]) with the ML layers' data:

  /search    GET  start,goal = node id ("n123") OR "lat,lng"  -> path + cost +
                   geometry ([[lat,lng],...]) + straight_m/ratio detour metrics
  /coverage  GET  area=demo|test|nova -> aerial-inferred sidewalk/crosswalk GeoJSON
  /incidents GET/POST hazard reports (JSONL-backed; map pins for the app)
  /detect    POST multipart image + conf -> barrier detections (YOLO11s;
                  503 + clear message while weights are still training)
  /health    GET  model + graph + coverage status

Real graph: data/router_graph/{adjacency,tubes,meta}.json (built by
backend/ml/aerial/build_router_graph.py — 3535 nodes, 3401 tubes). Falls back
to the built-in toy graph when the data dir is absent so the API always runs.

Run:
  backend/tile2net/.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8100
"""
import heapq
import json
import math
import pathlib
import time

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import UnidentifiedImageError
from pydantic import BaseModel, Field
from typing import List

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = ROOT  # backend/.. == repo root

TOY_GRAPH = [
    {
        "A": {"B", "C"},
        "B": {"A", "C", "D"},
        "C": {"A", "B", "D"},
        "D": {"B", "C", "E"},
        "E": {"D", "F"},
        "F": {"E", "G"},
        "G": {"F"},
    },
    {
        ("A", "B"): 1, ("B", "A"): 1,
        ("A", "C"): 4, ("C", "A"): 4,
        ("B", "C"): 2, ("C", "B"): 2,
        ("B", "D"): 5, ("D", "B"): 5,
        ("C", "D"): 1, ("D", "C"): 1,
        ("D", "E"): 3, ("E", "D"): 3,
        ("E", "F"): 2, ("F", "E"): 2,
        ("F", "G"): 2, ("G", "F"): 2,
    },
]


def _load_graph():
    """[(adjacency, tube_weights), meta] from the router handoff, else toy graph."""
    data = REPO / "data" / "router_graph"
    if not (data / "adjacency.json").exists():
        return TOY_GRAPH, {"nodes": 7, "tubes": 9, "fallback": True}
    try:
        from backend.ml.aerial.router_graph import load
        graphs, meta = load(str(data))
    except Exception:  # pragma: no cover - corrupt data should still let the app run
        return TOY_GRAPH, {"nodes": 7, "tubes": 9, "fallback": True}
    adjacency, tubes = graphs
    # A* indexes graph[1][(a, b)] for both traversal directions; the handoff
    # stores one direction per pair, so mirror weights (symmetric tube length).
    for (a, b), w in list(tubes.items()):
        tubes.setdefault((b, a), w)
    return [adjacency, tubes], meta


def heuristic(node, goal, graph) -> float:
    return 0.0
def generate_a_star(state, explored, graph):
   path = [state]
   cost = 0
   parent = state
   current = explored[parent][0]
   while current != "s":
      cost += graph[1][(current,parent)]
      path.append(current)
      parent = current
      current = explored[parent][0]
   return path[::-1], cost
def a_star(start, goal, graph, heuristic=heuristic):
   if start not in graph[0]:
      raise HTTPException(status_code=404, detail=f"Node '{start}' not in graph")
   if goal not in graph[0]:
      raise HTTPException(status_code=404, detail=f"Node '{goal}' not in graph")
   h_start = heuristic(start,goal,graph)
   frontier, explored = [], {start: ("s",h_start)} # heuristic is total cost
   heapq.heappush(frontier,(h_start,0,start)) # total cost, cost to reach, state
   while len(frontier) > 0:
      tc,pc,s = heapq.heappop(frontier)
      if tc > explored[s][1]:
         continue
      if s == goal:
         path, cost = generate_a_star(s, explored, graph)
         return path, cost
      for a in graph[0][s]:  #graph[3] is neighbors
         new_pc = pc + graph[1][(s,a)]
         new_tc = new_pc + heuristic(a,goal,graph)
         if a not in explored or new_tc < explored[a][1]:
            explored[a] = (s,new_tc)
            heapq.heappush(frontier,(new_tc,new_pc,a))
   return None


GRAPH, _META = _load_graph()
NO_DATA = """hazard detector is warming up — model weights are still training
(run backend/ml/street/train_colab.ipynb, then drop best.pt into
backend/ml/street/weights/)."""

_MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB (C1 contract)

app = FastAPI(title="Stryde MVP API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _nearest_nodes(lat, lng, k: int = 6):
    """k nearest graph nodes to a lat,lng (haversine over node coords)."""
    latlngs = _META.get("node_latlng") or {}
    if not latlngs:
        raise HTTPException(status_code=400, detail="graph has no coordinates; pass a node id")
    scored = []
    for n, (nlat, nlng) in latlngs.items():
        dy = (nlat - lat) * 111_320.0
        dx = (nlng - lng) * 111_320.0 * math.cos(math.radians(lat))
        scored.append((dx * dx + dy * dy, n, nlat, nlng))
    scored.sort(key=lambda t: t[0])
    out = []
    for d2, n, nlat, nlng in scored[:k]:
        d = math.sqrt(d2)
        if d <= 400:
            out.append({"node": n, "dist_m": round(d, 1),
                        "latlng": [round(nlat, 6), round(nlng, 6)]})
    return out


def _resolve_candidates(token: str):
    """Node id -> one candidate; 'lat,lng' -> up to 6 nearest node candidates."""
    t = token.strip()
    if t in GRAPH[0]:
        return [{"node": t, "dist_m": 0.0, "latlng": None}]
    parts = t.split(",")
    if len(parts) == 2:
        try:
            lat, lng = float(parts[0]), float(parts[1])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"cannot parse '{t}' (node id or 'lat,lng')")
        cands = _nearest_nodes(lat, lng)
        if not cands:
            raise HTTPException(status_code=404,
                                detail=NO_GRAPH_NEARBY.format(lat=lat, lng=lng))
        return cands
    raise HTTPException(status_code=400, detail=f"unknown node '{t}' (use node id or 'lat,lng')")


NO_GRAPH_NEARBY = (
    "No sidewalk-graph node within 400 m of {lat},{lng} — is the backend serving "
    "the same coverage area as the app? Check /health coverage and /coverage.")
NO_PATH_NEARBY = (
    "No walking connection between '{start}' and '{goal}': every attempt landed in "
    "different connected sidewalk components (heal coverage or pick points closer "
    "to a covered corridor).")


@app.get("/")
def root():
    return {"message": "Stryde MVP API", "routes": ["/search", "/coverage", "/detect", "/health"]}


def _haversine(a, b):
    lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    p = math.pi / 180.0
    hav = (0.5 - math.cos((lat2 - lat1) * p) / 2.0
           + math.cos(lat1 * p) * math.cos(lat2 * p)
           * (1 - math.cos((lng2 - lng1) * p)) / 2.0)
    return 12742_000.0 * math.asin(math.sqrt(hav))


@app.get("/search")
def search(start: str = Query(...), goal: str = Query(...)):
    s_start = start.strip()
    s_goal = goal.strip()
    s_cands = _resolve_candidates(s_start)
    g_cands = _resolve_candidates(s_goal)
    latlngs = _META.get("node_latlng") or {}

    # The aerial graph is fragmented into sidewalk components; a single nearest
    # node per side can easily pair across components. Try the nearest few
    # candidates on each side until a walkable path exists.
    path = cost = s_used = g_used = None
    tried = 0
    for sc in s_cands:
        for gc in g_cands:
            tried += 1
            if tried > 24:
                break
            result = a_star(sc["node"], gc["node"], GRAPH)
            if result is not None:
                path, cost = result
                s_used, g_used = sc, gc
                break
        if path:
            break
    if path is None:
        raise HTTPException(status_code=404, detail=NO_PATH_NEARBY.format(start=start, goal=goal))

    # Polyline draws the entered endpoints (lat,lng inputs) through the snapped
    # nodes, so the user sees the full walk, including the two snap walks.
    s_point = None
    g_point = None
    if "," in s_start:
        try:
            s_point = [float(v) for v in s_start.split(",")]
        except ValueError:
            pass
    if "," in s_goal:
        try:
            g_point = [float(v) for v in s_goal.split(",")]
        except ValueError:
            pass

    geometry = [p for p in ([s_point] if s_point else [])]
    for n in path:
        ll = latlngs.get(n)
        if ll:
            geometry.append(ll)
    geometry += [p for p in ([g_point] if g_point else [])]
    geometry = [[round(p[0], 6), round(p[1], 6)] for p in geometry]

    snap_connect = s_used["dist_m"] + g_used["dist_m"]

    straight_m = None
    if s_point and g_point:
        straight_m = round(_haversine(s_point, g_point), 1)

    return {
        "start": start, "goal": goal,
        "start_node": s_used["node"], "goal_node": g_used["node"],
        "snap": {"start_m": s_used["dist_m"], "goal_m": g_used["dist_m"]},
        "snapped_connect_m": round(snap_connect, 1),
        "snapped_points": {
            "start": s_used["latlng"], "goal": g_used["latlng"]},
        "snap_candidates_tried": tried,
        "path": path, "cost": cost,               # tube-only network meters
        "total_cut_m": round(cost + snap_connect, 1),  # incl. both snaps
        "straight_m": straight_m,  # crow-flies; null for node-id inputs
        "ratio": round(round(cost + snap_connect, 1) / straight_m, 3)
                  if straight_m and straight_m > 0 else None,
        "geometry": geometry,
        "graph": {"nodes": _META.get("nodes"), "tubes": _META.get("tubes")},
    }


_COVERAGE = {
    "demo": "data/demo_area_inferred.geojson",
    "test": "data/test_area_inferred.geojson",
    "nova": "data/nova_area_inferred.geojson",
}


def _coverage_file(area: str) -> pathlib.Path:
    rel = _COVERAGE.get(area)
    if rel is None:
        raise HTTPException(status_code=404, detail=f"no coverage area '{area}' (demo|test|nova)")
    file = REPO / rel
    if not file.exists():
        raise HTTPException(status_code=503, detail=f"coverage file missing: run the aerial pipeline ({rel})")
    return file


_INCIDENTS_PATH = REPO / "data" / "incidents.jsonl"


class IncidentIn(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    location: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    detected: List[str] = Field(default_factory=list, max_length=32)


def _load_incidents():
    if not _INCIDENTS_PATH.exists():
        return []
    out = []
    for line in _INCIDENTS_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


@app.post("/incidents")
def add_incident(inc: IncidentIn):
    """Persist one hazard report (JSON lines store at data/incidents.jsonl)."""
    latlng = None
    lat_s, _, lng_s = inc.location.partition(",")
    if lng_s:
        try:
            lat_v, lng_v = float(lat_s), float(lng_s)
            if -90 < lat_v < 90 and -180 < lng_v < 180:
                latlng = [lat_v, lng_v]
        except ValueError:
            pass
    existing = _load_incidents()
    record = {
        "id": len(existing) + 1,
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "type": inc.type.strip(),
        "location": inc.location.strip(),
        "latlng": latlng,
        "description": inc.description.strip(),
        "detected": inc.detected,
    }
    with _INCIDENTS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


@app.get("/incidents")
def list_incidents(limit: int = Query(200, ge=1, le=1000)):
    """Most recent reports first (map pins for the app)."""
    return {"incidents": _load_incidents()[-limit:][::-1],
            "total_in_file": len(_load_incidents())}


@app.get("/coverage")
def coverage(area: str = Query("demo", description="demo|test|nova")):
    file = _coverage_file(area)
    return {"area": area, "file": file.name,
            "geojson": json.loads(file.read_text())}


def _weights_status():
    from backend.ml.street.scripts.detector import WEIGHTS_CANDIDATES
    for cand in WEIGHTS_CANDIDATES:
        if cand.exists():
            return str(cand)
    return None


@app.get("/health")
def health():
    return {
        "ok": True,
        "weights": _weights_status(),
        "graph": {"nodes": _META.get("nodes"), "tubes": _META.get("tubes"),
                  "fallback": bool(_META.get("fallback"))},
        "coverage": [a for a, rel in _COVERAGE.items() if (REPO / rel).exists()],
    }


@app.post("/detect")
async def detect_endpoint(file: UploadFile = File(), conf: float = Form(0.25)):
    data = await file.read()
    if len(data) > _MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="upload exceeds 10 MB")
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")
    try:
        from backend.ml.street.scripts.detector import detect
        return {"detections": detect(data, conf=conf)}
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail=NO_DATA)
    except UnidentifiedImageError:
        raise HTTPException(status_code=400, detail="unrecognized/corrupt image upload")
