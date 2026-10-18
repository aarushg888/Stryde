import heapq
import json
import math
import pathlib
import time
import concurrent.futures
import asyncio
import csv
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import UnidentifiedImageError
from pydantic import BaseModel, Field
from typing import List
import pandas as pd
from scipy.spatial import KDTree
import numpy as np
import pickle
ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO = ROOT  # backend/.. == repo root

# --- Constants & Database Paths ---
HAZARDS_DB = REPO / "data" / "user_hazards.csv"
USER_PREFS = REPO / "data" / "user_prefs.json"
cost_specs = [
    {
        "crossing_base":2,
        "crossing_length":4,
        "unknown": 300,
        "vehicle": 40,
        "bicycle": 800,
        "pedestrians":2000,
        "fatal_pedestrian": 10**6
    },
    {   
        "crossing_base":2,
        "crossing_length":3,
        "unknown": 150,
        "vehicle": 20,
        "bicycle": 400,
        "pedestrians":1200,
        "fatal_pedestrian": 10**4
    },
    {
        "crossing_base":1,
        "crossing_length":2,
        "unknown": 75,
        "vehicle": 10,
        "bicycle": 100,
        "pedestrians":600,
        "fatal_pedestrian": 10**2
    },
    {
        "crossing_base": 0,
        "crossing_length":0,
        "unknown": 0,
        "vehicle": 0,
        "bicycle": 0,
        "pedestrians":0,
        "fatal_pedestrian": 0
    },
]
def _load_graph_osm():
    data = REPO / "data" / "osm" / "pickle"
    with open(data / "node_latlng.pkl", 'rb') as file:
        node_latlng = pickle.load(file)
    with open(data / "adjacencies.pkl", 'rb') as file:
        adjacencies = pickle.load(file)
    with open(data / "tube_kind.pkl", 'rb') as file:
        tube_kind = pickle.load(file)
    with open(data / "tubes.pkl", 'rb') as file:
        tubes = pickle.load(file)
    node_latlng = dict(node_latlng)
    adjacencies = dict(adjacencies)
    tubes = dict(tubes)
    tube_kind = dict(tube_kind)

    return [adjacencies, tubes, tube_kind],node_latlng
        
def _load_graph_ml():
    """[(adjacency, tube_weights), meta] from the router handoff, else toy graph."""
    data = REPO / "data" / "router_graph"
    from backend.ml.aerial.router_graph import load
    graphs, meta = load(str(data))
    return graphs, meta.get("node_latlng") or {}
# GRAPH, latlngs = _load_graph_ml()
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
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


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

@app.get("/search")
async def search(start: str = Query(...), goal: str = Query(...)):
    s_start = start.strip()
    s_goal = goal.strip()
    s_cands = _resolve_candidates(s_start)
    g_cands = _resolve_candidates(s_goal)
    loop = asyncio.get_running_loop()
    tasks = []
    final_paths = []
    for cost_spec in cost_specs:
        # result = cost_spec_caller(s_start, s_goal, s_cands, g_cands, cost_spec)
        task = loop.run_in_executor(
            executor, 
            cost_spec_caller, 
            s_start, s_goal, s_cands,g_cands,cost_spec
        )
        tasks.append(task)
        # if result is not None:
        #     final_paths.append(result)
    final_paths = await asyncio.gather(*tasks)
    if any(r is None for r in final_paths):
        raise HTTPException(status_code=404, detail=NO_PATH_NEARBY.format(start=start, goal=goal))
    return final_paths[0]
    # return {"paths": final_paths}



INCIDENTS_PATH = REPO / "data" / "Crashes_in_DC.csv"
LAT0 = 38.9
def to_xy(lat, lng):
    return lat * 111320.0, lng * 111320.0 * np.cos(np.radians(LAT0))

incident_df = (pd.read_csv(INCIDENTS_PATH)
                 .dropna(subset=['LATITUDE', 'LONGITUDE'])
                 .reset_index(drop=True))
x, y = to_xy(incident_df['LATITUDE'].to_numpy(), incident_df['LONGITUDE'].to_numpy())
tree = KDTree(np.column_stack([x, y]))

def get_incident_score(ll,cost_spec):
    idx = tree.query_ball_point(to_xy(ll[0], ll[1]), r=20)
    if not idx:
        return 0
    nearby = incident_df.iloc[idx]     
    val = (nearby['TOTAL_VEHICLES'].sum() * cost_spec["vehicle"]
            + nearby['TOTAL_BICYCLES'].sum() * cost_spec["bicycle"]
            + nearby['TOTAL_PEDESTRIANS'].sum() * cost_spec["pedestrians"]
            + nearby['FATAL_PEDESTRIAN'].sum() * cost_spec["fatal_pedestrian"])
    return val

@app.get("/health")
def health(): return {"ok": True, "weights": "detected", "coverage": ["demo"] }

@app.post("/report")
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
    return {"status": "reported"}

@app.post("/detect")
async def detect_endpoint(file: UploadFile = File(), conf: float = Form(0.25)):
    data = await file.read()
    try:
        from backend.ml.street.scripts.detector import detect
        return {"detections": detect(data, conf=conf)}
    except Exception as e: raise HTTPException(status_code=503, detail=str(e))

@app.get("/preferences")
def get_prefs():
    with open(USER_PREFS, 'r') as f: return json.load(f)

@app.post("/preferences")
def set_prefs(prefs: dict):
    with open(USER_PREFS, 'w') as f: json.dump(prefs, f)
    return prefs
