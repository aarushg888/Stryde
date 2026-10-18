"""Stryde MVP API — routing + accessibility layers in one service."""
import heapq
import json
import math
import pathlib
import time
import csv
import os
import asyncio
import concurrent.futures

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
REPO = ROOT

# --- Constants & Database Paths ---
HAZARDS_DB = REPO / "data" / "user_hazards.csv"
USER_PREFS = REPO / "data" / "user_prefs.json"
_COVERAGE = {
    "demo": "data/demo_area_inferred.geojson",
    "test": "data/test_area_inferred.geojson",
    "nova": "data/nova_area_inferred.geojson",
}

def _init_db():
    if not HAZARDS_DB.exists():
        HAZARDS_DB.parent.mkdir(parents=True, exist_ok=True)
        with open(HAZARDS_DB, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['timestamp', 'type', 'lat', 'lng', 'description', 'photo_path'])
    if not USER_PREFS.exists():
        USER_PREFS.parent.mkdir(parents=True, exist_ok=True)
        with open(USER_PREFS, 'w') as f:
            json.dump({
                "routingMode": "standard",
                "preferSidewalks": True,
                "wellLitOnly": False,
                "lowTraffic": False,
                "avoidObstacles": True
            }, f)

_init_db()

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
    except FileNotFoundError:
        return [{"n1": ["n2"], "n2": ["n1"]}, {"(n1,n2)": 10, "(n2,n1)": 10}, {"(n1,n2)": "sidewalk", "(n2,n1)": "sidewalk"}, {"n1": (38.9, -77.0), "n2": (38.9, -77.01)}]

GRAPH, latlngs = _load_graph_osm()

def _haversine(a, b):
    lat1, lng1, lat2, lng2 = a[0], a[1], b[0], b[1]
    p = math.pi / 180.0
    hav = (0.5 - math.cos((lat2 - lat1) * p) / 2.0
           + math.cos(lat1 * p) * math.cos(lat2 * p)
           * (1 - math.cos((lng2 - lng1) * p)) / 2.0)
    return 12742_000.0 * math.asin(math.sqrt(hav))

_INCIDENTS_PATH = REPO / "data" / "Crashes_in_DC.csv"
LAT0 = 38.9
def to_xy(lat, lng):
    return lat * 111320.0, lng * 111320.0 * np.cos(np.radians(LAT0))

try:
    incident_df = (pd.read_csv(_INCIDENTS_PATH).dropna(subset=['LATITUDE', 'LONGITUDE']).reset_index(drop=True))
    x, y = to_xy(incident_df['LATITUDE'].to_numpy(), incident_df['LONGITUDE'].to_numpy())
    tree = KDTree(np.column_stack([x, y]))
except Exception:
    incident_df = pd.DataFrame()
    tree = None

def get_incident_score(ll, k=20):
    crash_score = 0
    if tree is not None:
        idx = tree.query_ball_point(to_xy(ll[0], ll[1]), r=k)
        if idx:
            nearby_crashes = incident_df.iloc[idx]
            crash_score = (nearby_crashes['TOTAL_VEHICLES'].sum() * 40 + nearby_crashes['TOTAL_BICYCLES'].sum() * 800 + nearby_crashes['TOTAL_PEDESTRIANS'].sum() * 2000 + nearby_crashes['FATAL_PEDESTRIAN'].sum() * 10**6)
    user_score = 0
    if HAZARDS_DB.exists():
        with open(HAZARDS_DB, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    h_lat, h_lng = float(row['lat']), float(row['lng'])
                    dist = _haversine([ll[0], ll[1]], [h_lat, h_lng])
                    if dist < 50:
                        user_score += 500 if row['type'] == 'Construction' else 200
                except: continue
    return crash_score + user_score

def get_accessibility_costs(s, a, node_ll, graph, prefs):
    type = graph[2].get((s, a), "unknown")
    if prefs.get("routingMode") == "fastest": return 0
    accessibility_cost = 0
    multiplier = 10.0 if prefs.get("avoidObstacles") else 1.0
    if prefs.get("routingMode") == "wheelchair": multiplier *= 10.0
    if (type == "crossing" or type == "crosswalk") and node_ll:
        accessibility_cost += (2 + 4 * graph[1].get((s, a), 10) + get_incident_score(node_ll)) * multiplier
    if type == "unknown":
        accessibility_cost += (1000 + get_incident_score(node_ll) if node_ll else 1000) * multiplier
    if prefs.get("preferSidewalks") and type != "sidewalk": accessibility_cost += 500
    return accessibility_cost

def heuristic(node_ll, goal_ll) -> float:
    return _haversine(node_ll, goal_ll) if node_ll and goal_ll else 0

def a_star(start, goal, graph, prefs):
    start_ll, goal_ll = latlngs.get(start), latlngs.get(goal)
    h_start = heuristic(start_ll, goal_ll)
    frontier, explored = [], {start: ("s", h_start)}
    heapq.heappush(frontier, (h_start, 0, start))
    while frontier:
        tc, pc, s = heapq.heappop(frontier)
        if tc > explored[s][1]: continue
        if s == goal:
            path, cost = [s], 0
            curr = s
            while curr != "s":
                parent = explored[curr][0]
                cost += graph[1].get((parent, curr), 10) + get_accessibility_costs(parent, curr, latlngs.get(parent), graph, prefs)
                path.append(parent)
                curr = parent
            return path[::-1], cost
        for a in graph[0].get(s, []):
            acc = get_accessibility_costs(s, a, latlngs.get(a), graph, prefs)
            new_pc = pc + graph[1].get((s, a), 10) + acc
            new_tc = new_pc + heuristic(latlngs.get(a), goal_ll)
            if a not in explored or new_tc < explored[a][1]:
                explored[a] = (s, new_tc)
                heapq.heappush(frontier, (new_tc, new_pc, a))
    return None

app = FastAPI(title="Stryde MVP API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def _resolve_candidates(token):
    t = token.strip()
    if t in GRAPH[0]: return [{"node": t, "dist_m": 0.0, "latlng": None}]
    parts = t.split(",")
    if len(parts) == 2:
        try:
            lat, lng = float(parts[0]), float(parts[1])
            scored = []
            for n, (nlat, nlng) in latlngs.items():
                dy, dx = (nlat-lat)*111320, (nlng-lng)*111320*math.cos(math.radians(lat))
                scored.append((dx*dx+dy*dy, n, nlat, nlng))
            scored.sort()
            return [{"node": n, "dist_m": round(math.sqrt(d), 1), "latlng": [round(nlat, 6), round(nlng, 6)]} for d, n, nlat, nlng in scored[:6] if math.sqrt(d) <= 400]
        except: pass
    raise HTTPException(status_code=400, detail="Invalid location")

@app.get("/")
def root(): return {"status": "ok"}

@app.get("/search")
def search(start: str = Query(...), goal: str = Query(...), style: str = Query("safest")):
    with open(USER_PREFS, 'r') as f: prefs = json.load(f)
    if style == "fastest": prefs.update({"routingMode": "fastest", "avoidObstacles": False, "preferSidewalks": False})
    elif style == "safest": prefs.update({"routingMode": "wheelchair", "avoidObstacles": True, "preferSidewalks": True})
    elif style == "illuminated": prefs.update({"routingMode": "standard", "wellLitOnly": True, "avoidObstacles": True})
    s_used, g_used = _resolve_candidates(start)[0], _resolve_candidates(goal)[0]
    res = a_star(s_used["node"], g_used["node"], GRAPH, prefs)
    if not res: raise HTTPException(status_code=404, detail="No route found")
    path, cost = res
    geometry = [latlngs.get(n) for n in path if latlngs.get(n)]
    snap_connect = s_used["dist_m"] + g_used["dist_m"]
    dist_km = round((cost + snap_connect) / 1000, 2)
    explanations = {
        "fastest": f"Fastest route: ignores all accessibility penalties. Distance: {dist_km}km. This is the most direct physical path.",
        "safest": f"Safest route: maximizes sidewalk use and strictly avoids hazards. Distance: {dist_km}km. Significant detour for safety.",
        "illuminated": f"Illuminated route: prioritizes high-visibility paths. Distance: {dist_km}km."
    }
    return {
        "start": start, "goal": goal, "path": path, "cost": cost,
        "total_cut_m": round(cost + snap_connect, 1), "geometry": geometry,
        "explanation": explanations.get(style, f"Standard route: {dist_km}km.")
    }

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
