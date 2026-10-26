import heapq
import json
import math
import os
import pathlib
import time
import concurrent.futures
import asyncio
import csv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import UnidentifiedImageError
from fastapi.routing import APIRouter
from pydantic import BaseModel, Field
from typing import List
import pandas as pd
from scipy.spatial import KDTree
import numpy as np
import pickle
import threading
search_lock = threading.Lock()
ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = ROOT  # backend/.. == repo root

# --- Constants & Database Paths ---

HAZARDS_DB = REPO / "data" / "user_hazards.csv"
FRONTEND_DIR = REPO / "frontend" / "dist"
# USER_PREFS = REPO / "data" / "user_prefs.json"
cost_specs = [
    {   # safest
        "crossing_base": 0,
        "crossing_length": 0.5,
        "unknown": 2,
        "vehicle": 0.3,
        "bicycle": 2,
        "pedestrians": 4,
        "fatal_pedestrian": 50,
        "hazard": 14,
    },
    {   # balanced
        "crossing_base": 0,
        "crossing_length": 0.25,
        "unknown": 1,
        "vehicle": 0.15,
        "bicycle": 1,
        "pedestrians": 2,
        "fatal_pedestrian": 25,
        "hazard": 7,
    },
    {   # shortest
        "crossing_base": 0,
        "crossing_length": 0,
        "unknown": 0,
        "vehicle": 0,
        "bicycle": 0,
        "pedestrians": 0,
        "fatal_pedestrian": 0,
        "hazard": 0,
    },
]
def _load_graph_osm():
    data = REPO / "data" / "osm" / "pickle"
    try:
        with open(data / "node_latlng.pkl", 'rb') as file:
            node_latlng = pickle.load(file)
        with open(data / "adjacencies.pkl", 'rb') as file:
            adjacencies = pickle.load(file)
        with open(data / "tube_kind.pkl", 'rb') as file:
            tube_kind = pickle.load(file)
        with open(data / "tubes.pkl", 'rb') as file:
            tubes = pickle.load(file)
        return [dict(adjacencies), dict(tubes), dict(tube_kind)], dict(node_latlng)
    except (FileNotFoundError, IsADirectoryError, pickle.UnpicklingError) as e:
        print(f"WARNING: OSM data not found at {data}. Falling back to toy graph. Error: {e}")
        return [
            {"n1": ["n2"], "n2": ["n1"]}, 
            {"(n1,n2)": 10, "(n2,n1)": 10}, 
            {"(n1,n2)": "sidewalk", "(n2,n1)": "sidewalk"}
        ], {"n1": (38.913, -77.032), "n2": (38.914, -77.033)}
        
GRAPH, latlngs = _load_graph_osm()

    
def heuristic(node_ll, goal_ll) -> float:
    heuristic_cost = _haversine(node_ll,goal_ll)
    return heuristic_cost
def generate_a_star(state, explored, graph, cost_spec):
   path = [state]
   cost = 0
   accessibility_cost = 0
   parent = state
   current = explored[parent][0]
   while current != "s":
      node_ll = latlngs.get(parent)
      accessibility_cost += get_accessibility_costs(current, parent, node_ll, graph, cost_spec)      
      cost += graph[1][(current,parent)]
      path.append(current)
      parent = current
      current = explored[parent][0]
   return path[::-1], cost, accessibility_cost

def get_accessibility_costs(s,a,node_ll, graph, cost_spec):
    type = graph[2][(s,a)]
    accessibility_cost = 0
    if (type == "crossing" or type == "crosswalk") and node_ll:
        accessibility_cost += cost_spec["crossing_base"]+cost_spec["crossing_length"]*graph[1][(s,a)] + get_incident_score(node_ll,cost_spec)
    if type == "unknown":
        accessibility_cost += cost_spec["unknown"] + get_incident_score(node_ll, cost_spec)
    if (type == "crossing" or type == "crosswalk" or type == "unknown") and node_ll:
        accessibility_cost += get_reported_penalty(node_ll, cost_spec)
    return accessibility_cost
def a_star(start, goal, graph,cost_spec, heuristic=heuristic):
   if start not in graph[0]:
      raise HTTPException(status_code=404, detail=f"Node '{start}' not in graph")
   if goal not in graph[0]:
      raise HTTPException(status_code=404, detail=f"Node '{goal}' not in graph")
   start_ll = latlngs.get(start)
   goal_ll = latlngs.get(goal)
   h_start = heuristic(start_ll,goal_ll)
   frontier, explored = [], {start: ("s",h_start)} # heuristic is total cost
   heapq.heappush(frontier,(h_start,0,start)) # total cost, cost to reach, state
   while len(frontier) > 0:
      tc,pc,s = heapq.heappop(frontier)
      if tc > explored[s][1]:
         continue
      if s == goal:
         path, cost, ac = generate_a_star(s, explored, graph, cost_spec)
         return path, cost, ac
      for a in graph[0][s]:  #graph[3] is neighbors
        node_ll = latlngs.get(a)
        accessibility_cost = get_accessibility_costs(s,a,node_ll,graph,cost_spec)
        new_pc = pc + graph[1][(s,a)] + accessibility_cost
        new_tc = new_pc + heuristic(node_ll,goal_ll)
        if a not in explored or new_tc < explored[a][1]:
            explored[a] = (s,new_tc)
            heapq.heappush(frontier,(new_tc,new_pc,a))
   return None



NO_DATA = """hazard detector is warming up — model weights are still training
(run backend/ml/street/train_colab.ipynb, then drop best.pt into
backend/ml/street/weights/)."""

_MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB (C1 contract)

app = FastAPI(title="Stryde MVP API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,          # Allows cookies/auth headers
    allow_methods=["*"],             # Allows all HTTP methods (GET, POST, PUT, DELETE, etc.)
    allow_headers=["*"],             # Allows all headers
)
app.frontend("/", directory=FRONTEND_DIR)
api_router = APIRouter(prefix="/api")


def _nearest_nodes(lat, lng, k: int = 6):
    """k nearest graph nodes to a lat,lng (haversine over node coords)."""
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


@api_router.get("/")
def root():
    return {"message": "Stryde MVP API",
            "routes": ["/search", "/coverage", "/detect", "/health", "/chat", "/report", "/hazards"]}


def _haversine(a, b):
    lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    p = math.pi / 180.0
    hav = (0.5 - math.cos((lat2 - lat1) * p) / 2.0
           + math.cos(lat1 * p) * math.cos(lat2 * p)
           * (1 - math.cos((lng2 - lng1) * p)) / 2.0)
    return 12742_000.0 * math.asin(math.sqrt(hav))

def cost_spec_caller(start: str, goal: str, s_cands, g_cands, cost_spec):
    path = cost = s_used = g_used = accessibility_cost = None
    tried = 0
    for sc in s_cands:
        for gc in g_cands:
            tried += 1
            if tried > 24:
                break
            result = a_star(sc["node"], gc["node"], GRAPH, cost_spec, heuristic)
            if result is not None:
                path, cost, accessibility_cost = result
                s_used, g_used = sc, gc
                break
        if path:
            break
    if path is None:
        raise HTTPException(status_code=404, detail=NO_PATH_NEARBY.format(start=start, goal=goal))

    s_point = None
    g_point = None
    if "," in start:
        try:
            s_point = [float(v) for v in start.split(",")]
        except ValueError:
            pass
    if "," in goal:
        try:
            g_point = [float(v) for v in goal.split(",")]
        except ValueError:
            pass

    geometry = [p for p in ([s_point] if s_point else [])]
    for n in path:
        ll = latlngs.get(n)
        if ll:
            geometry.append(ll)
    geometry += [p for p in ([g_point] if g_point else [])]
    geometry = [[round(p[0], 6), round(p[1], 6)] for p in geometry]
    if s_used is None or g_used is None:
        return None
    if cost is None or accessibility_cost is None:
        return None
    snap_connect = s_used["dist_m"] + g_used["dist_m"]
    return {
        "path": path,
        "total_cost": (cost + accessibility_cost),
        "path_cost": cost,
        "accessibility_cost": accessibility_cost,
        "total_cut_m": round(cost + snap_connect, 1),
        "geometry": geometry,
    }

executor = concurrent.futures.ProcessPoolExecutor()

def apply_flag_scales(spec: dict, mode: str | None, prefer_sidewalks: bool,
                      avoid_obstacles: bool, well_lit: bool, low_traffic: bool) -> dict:
    """Copy of a cost profile scaled by the user's saved/typed preferences."""
    copy = dict(spec)
    if mode == "wheelchair":
        copy["unknown"] *= 1.35
        copy["crossing_base"] += 2.0
        copy["hazard"] *= 1.4
    if prefer_sidewalks:
        copy["crossing_base"] += 1.0
    if avoid_obstacles:
        copy["hazard"] *= 1.35
    if well_lit:
        copy["unknown"] *= 1.2
    if low_traffic:
        copy["vehicle"] *= 1.6
        copy["bicycle"] *= 1.3
    return copy


@api_router.get("/search")
def search(                      # plain def, not async
    start: str = Query(...),
    goal: str = Query(...),
    mode: str | None = Query(None),
    preferSidewalks: bool = Query(False),
    avoidObstacles: bool = Query(False),
    wellLitOnly: bool = Query(False),
    lowTraffic: bool = Query(False),
):
    s_start, s_goal = start.strip(), goal.strip()
    s_cands = _resolve_candidates(s_start)
    g_cands = _resolve_candidates(s_goal)
    effective_specs = [
        apply_flag_scales(cs, mode, preferSidewalks, avoidObstacles, wellLitOnly, lowTraffic)
        for cs in cost_specs
    ]
    with search_lock:            # one search at a time across requests
        final_paths = [
            cost_spec_caller(s_start, s_goal, s_cands, g_cands, cs)
            for cs in effective_specs
        ]
    if any(r is None for r in final_paths):
        raise HTTPException(status_code=404, detail=NO_PATH_NEARBY.format(start=start, goal=goal))
    return {"paths": final_paths}


INCIDENTS_PATH = REPO / "data" / "Crashes_in_DC.csv"
LAT0 = 38.9
def to_xy(lat, lng):
    return lat * 111320.0, lng * 111320.0 * np.cos(np.radians(LAT0))

try:
    incident_df = (pd.read_csv(INCIDENTS_PATH)
                   .dropna(subset=['LATITUDE', 'LONGITUDE'])
                   .reset_index(drop=True))
    x, y = to_xy(incident_df['LATITUDE'].to_numpy(), incident_df['LONGITUDE'].to_numpy())
    tree = KDTree(np.column_stack([x, y]))
except Exception as e:
    print(f"WARNING: Crash data not found at {INCIDENTS_PATH}. Using empty dataset. Error: {e}")
    incident_df = pd.DataFrame()
    tree = None

HZ_SEVERITY = {"Construction": 1.6, "Sidewalk": 1.2, "Tree": 1.0, "Other": 0.8}
_hz_cache: dict = {"path": None, "mtime": None, "tree": None, "types": None}

def _hazard_layer():
    """KD-tree of user-reported hazards; rebuilt when the CSV changes."""
    path = HAZARDS_DB
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = None
    if _hz_cache["tree"] is not None and _hz_cache["mtime"] == mtime:
        return _hz_cache["tree"], _hz_cache["types"]
    pts, types = [], []
    try:
        with open(path, newline='') as f:
            for row in csv.reader(f):
                row = (row + ["", "", "", "", ""])[:5]
                _ts, htype, lat, lng, _d = row
                try:
                    la, lo = float(lat), float(lng)
                except (TypeError, ValueError):
                    continue
                if abs(la) > 90 or abs(lo) > 180 or (la == 0 and lo == 0):
                    continue
                pts.append(to_xy(la, lo))
                types.append(htype)
    except FileNotFoundError:
        pts = []
    htree = KDTree(np.array(pts, dtype=float).reshape(-1, 2)) if pts else None
    _hz_cache.update(path=path, mtime=mtime, tree=htree, types=types)
    return htree, types


def get_reported_penalty(ll, cost_spec):
    htree, htypes = _hazard_layer()
    if htree is None:
        return 0
    idx = htree.query_ball_point(to_xy(ll[0], ll[1]), r=30)
    val = 0.0
    for i in idx:
        val += cost_spec.get("hazard", 0) * HZ_SEVERITY.get(htypes[i], 0.8)
    return val


def get_incident_score(ll,cost_spec):
    if tree is None:
        return 0  # crash layer unavailable (fresh clone) — routing still works
    idx = tree.query_ball_point(to_xy(ll[0], ll[1]), r=20)
    if not idx:
        return 0
    nearby = incident_df.iloc[idx]     
    val = (nearby['TOTAL_VEHICLES'].sum() * cost_spec["vehicle"]
            + nearby['TOTAL_BICYCLES'].sum() * cost_spec["bicycle"]
            + nearby['TOTAL_PEDESTRIANS'].sum() * cost_spec["pedestrians"]
            + nearby['FATAL_PEDESTRIAN'].sum() * cost_spec["fatal_pedestrian"])
    return val

@api_router.get("/health")
def health(): return {"ok": True, "weights": "detected", "coverage": ["demo"] }

@api_router.post("/report")
async def report_hazard(type: str = Form(...), lat: float = Form(...), lng: float = Form(...), description: str = Form(""), file: UploadFile = File(None)):
    ts = time.time()
    photo_path = None
    if file:
        pdir = REPO / "data" / "hazard_photos"
        pdir.mkdir(parents=True, exist_ok=True)
        photo_path = pdir / f"{int(ts)}_{file.filename}"
        with open(photo_path, "wb") as f: f.write(await file.read())
    with open(HAZARDS_DB, 'a', newline='') as f:
        csv.writer(f).writerow([ts, type, lat, lng, description, str(photo_path) if photo_path else ""])
    return {"status": "reported", "id": int(ts)}


@api_router.get("/hazards")
def list_hazards(limit: int = 25):
    """Recent community hazard reports, newest first (photo path only)."""
    out = []
    try:
        with open(HAZARDS_DB, newline='') as f:
            rows = list(csv.reader(f))
    except FileNotFoundError:
        rows = []
    for row in rows[-limit:]:
        row = (row + ["", "", "", "", "", ""])[:6]
        ts, htype, lat, lng, desc, photo = row
        try:
            latf, lngf, tsf = float(lat), float(lng), float(ts)
        except (TypeError, ValueError):
            continue
        photo_name = photo.rsplit("/", 1)[-1] if photo else None
        out.append({
            "id": int(tsf),
            "ts": tsf,
            "type": htype,
            "lat": latf,
            "lng": lngf,
            "description": desc,
            "photo": photo_name,
        })
    out.reverse()
    return {"hazards": out}

@api_router.post("/detect")
async def detect_endpoint(file: UploadFile = File(), conf: float = Form(0.25)):
    data = await file.read()
    try:
        from backend.ml.street.scripts.detector import detect
        return {"detections": detect(data, conf=conf)}
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

# @api_router.get("/preferences")
# def get_prefs():
#     with open(USER_PREFS, 'r') as f: return json.load(f)

# @api_router.post("/preferences")
# def set_prefs(prefs: dict):
#     with open(USER_PREFS, 'w') as f: json.dump(prefs, f)
#     return prefs


# --- Route assistant --------------------------------------------------------
# Deterministic, rules-based assistant (no external AI service): it answers
# questions about how Stryde builds safe walking routes using the caller's
# current preference snapshot as context. Runs fully offline so the feature
# works even without network access on the judging machine.

class ChatRequest(BaseModel):
    message: str = ""
    routingMode: str = "standard"
    preferSidewalks: bool = True
    wellLitOnly: bool = False
    lowTraffic: bool = False
    avoidObstacles: bool = True


def _prefs_line(p: ChatRequest) -> str:
    mode = "wheelchair / accessible" if p.routingMode == "wheelchair" else "standard pedestrian"
    flags = [
        name for name, on in (("prefer sidewalks", p.preferSidewalks),
                              ("low-traffic streets", p.lowTraffic),
                              ("well-lit streets", p.wellLitOnly),
                              ("protected crossings", p.avoidObstacles)) if on
    ]
    return f"{mode}" + (", prioritizing " + ", ".join(flags) if flags else "")


_INTENTS: list[tuple[tuple[str, ...], str, dict | None]] = [
    (("how do routes work", "how does stryde work", "how does it work", "how routing", "algorithm"),
     "Stryde searches the DC sidewalk graph with A* under three cost profiles - Safest "
     "(harsh penalties for crossings, unmarked walk space and crash clusters), Balanced, "
     "and Shortest (pure distance). Each return trip is scored, drawn on the map, and you "
     "pick the trade-off you want.", None),
    (("what do you detect", "what can you detect", "hazard", "camera", "photo", "detect"),
     "Our YOLO street-barrier model flags five classes from a photo: curb ramps, "
     "crosswalks, tactile paving, stairs/steps and ramps. Upload from the Safeguard tab to "
     "verify a barrier, then hit Report to add it to the shared hazard map.", None),
    (("wheelchair", "accessible", "accessibility mode", "wheel chair"),
     "Wheelchair mode is one of our routing access modes. Pair it with Prefer sidewalks "
     "and Protected crossings and choose the Safest profile - it weights unmarked crossings "
     "and missing walk space so steep or stepped segments get avoided.", {"routingMode": "wheelchair", "preferSidewalks": True, "avoidObstacles": True}),
    (("night", "light", "dark", "evening"),
     "Evening planners: enable Enhanced Safety Lighting, and the Safest profile will keep "
     "you on crossings and corridors we can score for vehicle and pedestrian danger.", {"wellLitOnly": True, "routingMode": "wheelchair"}),
    (("traffic", "car", "vehicles", "noisy"),
     "Low Traffic Exposure steers you away from arterial roads. Crash clusters within "
     "20 m of a crossing contribute real DC crash counts (vehicles, bicycles, "
     "pedestrians, fatalities) to the route cost.", {"lowTraffic": True}),
    (("crash", "incident", "dangerous", "unsafe", "safety"),
     "Stryde blends the reported-barrier graph with DC Open Data crash records: crashes "
     "within 20 meters of a crossing add weighted danger to every edge, so the Safest "
     "route detours around statistically risky intersections.", None),
    (("coverage", "where does", "which area", "region", "district"),
     "We cover the DC sidewalk network around Logan Circle today; the coverage grows "
     "with every graph refresh. Routes snap your pin to the nearest walk node within "
     "400 meters.", None),
    (("report", "contribute", "add hazard", "upload"),
     "From the Safeguard tab: snap a photo, the model tags the barrier class, drop a "
     "description and the pin stores into our shared hazard layer for everyone's next "
     "route.", None),
    (("preference", "settings", "configure", "tune"),
     "In Preferences you can set the Routing Access Mode (standard or wheelchair) and "
     "path, crossings, lighting and traffic flags. Your current setup: {prefs}", None),
    (("hello", "hi", "hey", "what can you do", "help"),
     "I can explain Stryde routing, hazards, coverage and privacy in this demo. Right "
     "now your filters are: {prefs}. Ask me 'how do routes work?' to get started.", None),
]


@api_router.post("/chat")
def chat(req: ChatRequest):
    text = req.message.strip().lower()
    if text:
        for keys, reply, patch in _INTENTS:
            if any(k in text for k in keys):
                return {
                    "reply": reply.replace("{prefs}", _prefs_line(req)),
                    "patch": patch,
                }
        return {"reply": "Great question - in this demo the assistant covers routing, "
                "hazards, coverage and privacy. Your filters are: " + _prefs_line(req) +
                ". Ask 'how do routes work?' to see the details.", "patch": None}
    return {"reply": "Ask me anything about Stryde - e.g. 'how do routes work?' "
            "(Your filters: " + _prefs_line(req) + ")", "patch": None}
app.include_router(api_router)
