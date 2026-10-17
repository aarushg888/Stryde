#!/usr/bin/env python3
"""Connectivity check for the aerial centerline network (contract QA).

Builds a graph from a LineString GeoJSON: endpoints are snapped onto a shared
node id when they fall within --tolerance meters (metric CRS auto-picked from
center longitude). Reports connected components, largest-component length
share, and whether crosswalk lines touch sidewalk lines.

Usage:
  python connectivity.py --inferred data/demo_area_inferred.geojson \
      [--tolerance 2.0] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import math

import geopandas as gpd
import shapely


def _metric_epsg(lon: float) -> int:
    zone = math.floor((lon + 180) / 6) + 1
    return (32600 + zone) if lon >= 0 else (32700 + zone)


def build_graph(gdf: gpd.GeoDataFrame, tolerance: float):
    epsg = _metric_epsg((gdf.total_bounds[0] + gdf.total_bounds[2]) / 2)
    metric = gdf.to_crs(epsg)

    lines = metric.geometry.values
    n = len(lines)
    from scipy.spatial import cKDTree  # scipy ships with geopandas deps
    import numpy as np

    endpoints = []   # per-line: [(x, y), (x, y)]
    for geom in lines:
        coords = list(geom.coords)
        endpoints.append((coords[0][:2], coords[-1][:2]))

    # node-ify: assign each endpoint to a node id, merging within tolerance
    all_pts = []
    for (a, b) in endpoints:
        all_pts.append(a)
        all_pts.append(b)
    pts = np.array(all_pts)

    tree = cKDTree(pts)
    pairs = tree.query_pairs(r=tolerance, output_type="ndarray")

    parent = list(range(len(pts)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i, j in pairs:
        union(i, j)

    def node_of(endpoint_idx: int) -> int:
        return find(endpoint_idx)

    line_endpoint_nodes = []
    for line_idx in range(n):
        a = node_of(2 * line_idx)
        b = node_of(2 * line_idx + 1)
        line_endpoint_nodes.append((a, b))

    # adjacency: lines link at shared snapped nodes (self-loop = closed loop line)
    adjacency = {}
    for line_idx, (a, b) in enumerate(line_endpoint_nodes):
        adjacency.setdefault(a, []).append(line_idx)
        if b != a:
            adjacency.setdefault(b, []).append(line_idx)

    # connected components over lines via shared nodes
    comp = [-1] * n
    comps = 0
    for start in range(n):
        if comp[start] != -1:
            continue
        stack = [start]
        comp[start] = comps
        while stack:
            ln = stack.pop()
            for nd in line_endpoint_nodes[ln]:
                for other in adjacency.get(nd, []):
                    if comp[other] == -1:
                        comp[other] = comps
                        stack.append(other)
        comps += 1

    lengths = np.array([g.length for g in lines])
    return {
        "epsg": epsg,
        "n_lines": int(n),
        "n_components": comps,
        "component_of_line": comp,
        "lengths": lengths,
        "lines": lines,
        "kinds": list(gdf.get("kind", [None] * n)),
    }


def report(gdf: gpd.GeoDataFrame, tolerance: float, label: str) -> dict:
    import numpy as np

    g = build_graph(gdf, tolerance)
    lengths = g["lengths"]
    comp = np.array(g["component_of_line"])
    total = float(lengths.sum())
    largest_comp = int(np.argmax(np.bincount(comp)))
    largest_len = float(lengths[comp == largest_comp].sum())

    kinds = g["kinds"]
    sw_mask = np.array([k == "sidewalk" for k in kinds])
    cw_mask = np.array([k == "crosswalk" for k in kinds])
    conn_mask = np.array([k == "connector" for k in kinds])

    # a crosswalk line "links to sidewalk" if its component contains any sidewalk line
    def linked_share(mask, target_mask) -> float:
        if not mask.any():
            return 0.0
        linked = 0
        for i in np.where(mask)[0]:
            if target_mask[comp == comp[i]].any():
                linked += 1
        return linked / int(mask.sum())

    out = {
        "label": label,
        "lines": g["n_lines"],
        "total_length_m": round(total, 1),
        "components": g["n_components"],
        "largest_component_length_m": round(largest_len, 1),
        "largest_component_share": round(largest_len / total, 4) if total else None,
        "crosswalk_lines_linked_to_sidewalks_share": round(
            linked_share(cw_mask, sw_mask | conn_mask), 4) if cw_mask.any() else None,
        "sidewalk_lines_linked_to_crosswalks_share": round(
            linked_share(sw_mask, cw_mask | conn_mask), 4) if sw_mask.any() else None,
        "kind_counts": {k: int(v) for k, v in
                        {k: kinds.count(k) for k in sorted(set(kinds))}.items()},
    }
    return out


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--inferred", required=True)
    ap.add_argument("--tolerance", type=float, default=2.0)
    ap.add_argument("--label", default=None)
    ap.add_argument("--json", default=None, help="optional path to dump report JSON")
    args = ap.parse_args()

    gdf = gpd.read_file(args.inferred)
    r = report(gdf, args.tolerance, args.label or args.inferred)
    print(json.dumps(r, indent=2))
    if args.json:
        with open(args.json, "w") as f:
            json.dump(r, f, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
