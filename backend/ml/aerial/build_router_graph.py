#!/usr/bin/env python3
"""Router graph handoff for the teammate's start/end routing algorithm.

Converts an aerial centerline GeoJSON (e.g. data/demo_area_inferred.geojson)
into the two-part graph structure described for the routing team:

  graphs[0] = {node_id: [neighbor_id, ...]}        adjacency (who links to whom)
  graphs[1] = {(node_id, node_id): weight}         tubes (edge -> distance in meters)

Nodes are the endpoints of the centerlines, snapped together when they fall
within --tolerance meters (same 2 m default as connectivity.py). All kinds
(sidewalk/crosswalk/connector/footpath) are included as routable edges; a
closed-loop line (same node at both ends) contributes no tube.

Usage:
  ml/aerial/.venv/bin/python ml/aerial/build_router_graph.py \
      --inferred data/demo_area_inferred.geojson --out data/router_graph

Then in the router:

  from ml.aerial.router_graph import load
  graphs = load("data/router_graph")   # graphs[0] adjacency, graphs[1] tube->weight
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import geopandas as gpd

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from connectivity import _metric_epsg  # noqa: E402


def build(gdf: gpd.GeoDataFrame, tolerance: float):
    import numpy as np
    from scipy.spatial import cKDTree

    epsg = _metric_epsg((gdf.total_bounds[0] + gdf.total_bounds[2]) / 2)
    metric = gdf.to_crs(epsg)
    lines = metric.geometry.values

    endpoints = []
    for geom in lines:
        coords = list(geom.coords)
        endpoints.append((coords[0][:2], coords[-1][:2]))
    pts = np.array([p for pair in endpoints for p in pair])

    tree = cKDTree(pts)
    pairs = tree.query_pairs(r=tolerance, output_type="ndarray")
    parent = list(range(len(pts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i, j in pairs:
        union(i, j)

    # node coordinate (lat, lng) per union-find root (EPSG:4326)
    import collections
    root_pts = collections.defaultdict(list)
    for i in range(len(pts)):
        root_pts[find(i)].append(pts[i])
    roots = sorted(root_pts)
    cent = np.array([np.mean(root_pts[r], axis=0) for r in roots])
    pts4326 = gpd.GeoDataFrame(
        geometry=gpd.points_from_xy(cent[:, 0], cent[:, 1]), crs=epsg).to_crs(4326)
    latlngs = {f"n{r}": [round(float(la), 6), round(float(lo), 6)]
               for r, (la, lo) in zip(roots, zip(pts4326.geometry.y, pts4326.geometry.x))}

    adjacency = {}
    tubes = {}
    loops = 0
    for line_idx, geom in enumerate(lines):
        a = f"n{find(2 * line_idx)}"
        b = f"n{find(2 * line_idx + 1)}"
        w = float(geom.length)
        if a == b:
            loops += 1
            adjacency.setdefault(a, set())
            continue
        key = (a, b) if a < b else (b, a)
        if key not in tubes or w < tubes[key]:
            tubes[key] = round(w, 2)
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    return epsg, adjacency, tubes, loops, latlngs


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inferred", required=True)
    ap.add_argument("--out", default="data/router_graph")
    ap.add_argument("--tolerance", type=float, default=2.0)
    args = ap.parse_args()

    gdf = gpd.read_file(args.inferred)
    epsg, adjacency, tubes, loops, latlngs = build(gdf, args.tolerance)

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "adjacency.json", "w") as f:
        json.dump({n: sorted(v) for n, v in adjacency.items()}, f, indent=1)
    with open(out / "tubes.json", "w") as f:
        json.dump([[a, b, w] for (a, b), w in sorted(tubes.items())], f, indent=1)
    (out / "meta.json").write_text(json.dumps(
        {"epsg": epsg, "nodes": len(adjacency), "tubes": len(tubes),
         "weight": "length in meters (projected EPSG:%d)" % epsg,
         "tolerance_m": args.tolerance, "closed_loop_lines": loops,
         "node_latlng": latlngs,
         "source": args.inferred}, indent=2))
    print("nodes:", len(adjacency), "tubes:", len(tubes),
          "closed loops skipped:", loops, "->", out.resolve())


if __name__ == "__main__":
    main()
