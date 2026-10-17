"""Stryde MVP API — routing + accessibility layers in one service.

Merges the router team's A* /search (start/end nodes over a graph of
[adjacency, tube-weights]) with the ML layers' data:

  /search    GET  start,goal = node id ("n123") OR "lat,lng"  -> path + cost +
                  geometry ([[lat,lng],...]) for the map polyline
  /coverage  GET  area=demo|test|nova -> aerial-inferred sidewalk/crosswalk GeoJSON
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

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

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


def _nearest_node(lat, lng):
    """Nearest graph node to a lat,lng (haversine over node coords)."""
    latlngs = _META.get("node_latlng") or {}
    if not latlngs:
        raise HTTPException(status_code=400, detail="graph has no coordinates; pass a node id")
    best, best_m = None, float("inf")
    for n, (nlat, nlng) in latlngs.items():
        # local equirectangular projection: good enough at neighborhood scale
        dy = (nlat - lat) * 111_320.0
        dx = (nlng - lng) * 111_320.0 * math.cos(math.radians(lat))
        d = math.hypot(dx, dy)
        if d < best_m:
            best, best_m = n, d
    if best_m > 400:
        raise HTTPException(status_code=404, detail=f"no graph node within 400 m of {lat},{lng}")
    return best, best_m


def _resolve_node(token: str):
    """'n123' -> node id; '38.9,-77.03' -> nearest node id."""
    t = token.strip()
    if t in GRAPH[0]:
        return t, 0.0
    parts = t.split(",")
    if len(parts) == 2:
        try:
            lat, lng = float(parts[0]), float(parts[1])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"cannot parse '{t}' (node id or 'lat,lng')")
        return _nearest_node(lat, lng)
    raise HTTPException(status_code=400, detail=f"unknown node '{t}' (use node id or 'lat,lng')")


@app.get("/")
def root():
    return {"message": "Stryde MVP API", "routes": ["/search", "/coverage", "/detect", "/health"]}


@app.get("/search")
def search(start: str = Query(...), goal: str = Query(...)):
    s_node, s_m = _resolve_node(start)
    g_node, g_m = _resolve_node(goal)
    result = a_star(s_node, g_node, GRAPH)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"No walking connection from '{start}' to '{goal}': they lie in different "
                   f"connected sidewalk components (search heal coverage or try a closer pair)")
    path, cost = result
    latlngs = _META.get("node_latlng") or {}
    geometry = [latlngs.get(n) for n in path]
    geometry = [[p[0], p[1]] for p in geometry if p] if latlngs else []
    return {
        "start": start, "goal": goal,
        "start_node": s_node, "goal_node": g_node,
        "snap": {"start_m": round(s_m, 1), "goal_m": round(g_m, 1)},
        "snapped_connect_m": round(s_m + g_m, 1),
        "path": path, "cost": cost,               # tube-only network meters
        "total_cut_m": round(cost + s_m + g_m, 1),  # incl. both snaps
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
    except Exception:
        from PIL import UnidentifiedImageError
        raise HTTPException(status_code=400, detail="unrecognized/corrupt image upload")
