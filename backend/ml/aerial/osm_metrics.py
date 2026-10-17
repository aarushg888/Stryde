#!/usr/bin/env python3
"""Compare tile2net output against OpenStreetMap for a demo bbox (CPU).

Metrics computed (v2 design):
  1. Separate counts/lengths for (a) footway=sidewalk ways and (b) untyped
     highway=footway ways — NOT merged (different semantic quality).
  2. Recall proxies (within 3 m of tile2net centerlines) computed
     separately for tagged sidewalks, untyped footways, and crossings.
  3. Road-sidewalk recall: roads tagged sidewalk=left/right/both/yes — share
     of such road length with a tile2net sidewalk line within 15 m.
  4. "candidate_new_edges" — tile2net sidewalk/crosswalk length with no OSM
     sidewalk-or-footway within 5 m. CANDIDATE-ONLY label: includes false
     positives (gutters, parking aisles, private drives); verify before use.

Caveat: OpenStreetMap sidewalk data is incomplete and is not ground truth;
these are proxy metrics, not accuracy measurements.

Usage:
  python osm_metrics.py --inferred data/demo_area_inferred.geojson \
      --bbox "38.9182,-77.0380,38.9092,-77.0270" \
      --region washington-dc --out metrics/aerial_vs_osm.json \
      [--dump-new-edges ml/aerial/qa/new_edges_all.geojson]
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import pathlib
import sys
import warnings

import geopandas as gpd
import numpy as np
import osmnx as ox
import shapely

with warnings.catch_warnings():
    warnings.simplefilter("ignore")

WALK_KINDS = {"sidewalk", "footpath", "crosswalk", "connector"}

TRAINING_REGIONS = {
    "washington-dc": "DC",
    "boston": "Boston, MA",
    "cambridge": "Cambridge, MA",
    "nyc": "New York, NY",
    "new-york-city": "New York, NY",
    "manhattan": "New York, NY",
}

ROAD_HIGHWAYS = ["residential", "secondary", "primary", "tertiary",
                 "unclassified", "living_street", "service", "secondary_link",
                 "primary_link", "tertiary_link"]
WEST, BOTTOM, EAST, TOP = 0, 1, 2, 3


def _utm_epsg(lon: float) -> int:
    zone = math.floor((lon + 180) / 6) + 1
    return (32600 + zone) if lon >= 0 else (32700 + zone)


def _footway_ways(bbox):
    hw = ox.features_from_bbox(bbox=bbox, tags={"highway": ["footway"]})
    hw = hw.reset_index()
    hw = hw[(hw.get("element_type", hw.get("element")) == "way")]
    hw = hw[hw.geometry.geom_type.isin(["LineString", "MultiLineString"])]
    f = hw["footway"].astype(str) if "footway" in hw.columns else "nan"

    tagged = hw[(f == "sidewalk")].copy()
    tagged["osm_group"] = "footway_sidewalk_tagged"

    untyped = hw[(f == "nan")].copy()
    untyped["osm_group"] = "footway_untyped"

    crossing = hw[(f == "crossing")].copy()
    crossing["osm_group"] = "footway_crossing"

    return gpd.GeoDataFrame(
        gpd.GeoDataFrame(pd_concat_safe([tagged, untyped, crossing]), crs=hw.crs),
        crs=hw.crs,
    )


def pd_concat_safe(frames):
    import pandas as pd
    return pd.concat(frames, ignore_index=True)


def _sidewalk_roads(bbox):
    roads = ox.features_from_bbox(
        bbox=bbox,
        tags={"highway": ROAD_HIGHWAYS, "sidewalk": ["left", "right", "both", "yes"]},
    )
    roads = roads.reset_index()
    elem = "element_type" if "element_type" in roads.columns else "element"
    roads = roads[roads[elem] == "way"]
    roads = roads[roads.geometry.geom_type.isin(["LineString", "MultiLineString"])]
    return gpd.GeoDataFrame(roads[["geometry"]], crs=roads.crs)


def to_metric(gdf, lon):
    return gdf.to_crs(_utm_epsg(lon))


def evaluate(inferred_path, bbox, region: str) -> tuple[dict, gpd.GeoDataFrame | None]:
    lat_top, lon_left, lat_bottom, lon_right = bbox
    osm_bbox = (lon_left, lat_bottom, lon_right, lat_top)
    center_lon = (lon_left + lon_right) / 2.0

    inferred = gpd.read_file(inferred_path)
    if inferred.crs is None:
        inferred = inferred.set_crs(4326)
    elif inferred.crs.to_epsg() != 4326:
        inferred = inferred.to_crs(4326)

    T2N = to_metric(inferred, center_lon)
    t2n_walk = T2N[T2N["kind"].isin(WALK_KINDS)]
    t2n_sides = T2N[T2N["kind"] == "sidewalk"]
    t2n_sides_union = (
        shapely.union_all(t2n_sides.geometry.values) if len(t2n_sides) else None
    )

    foot = to_metric(_footway_ways(osm_bbox), center_lon)
    groups = list(foot["osm_group"].unique())

    out: dict = {"osm_groups": {}}
    for grp in ["footway_sidewalk_tagged", "footway_untyped", "footway_crossing"]:
        sub = foot[foot["osm_group"] == grp]
        rec = None
        length = float(sub.geometry.length.sum()) if len(sub) else 0.0
        if sub.empty:
            out["osm_groups"][grp] = {
                "count": 0, "length_m": 0.0,
                "recall_within_3m_share": None,
            }
            continue
        if t2n_walk is not None:
            u = shapely.union_all(sub.geometry.values)
            within = shapely.intersection(
                u, shapely.union_all(t2n_walk.geometry.values).buffer(3.0)
            )
            rec = ( shapely.length(within) / length) if length else None
        out["osm_groups"][grp] = {
            "count": int(len(sub)),
            "length_m": round(length, 1),
            "recall_within_3m_share": round(float(rec), 4) if rec is not None else None,
        }

    # --- road-sidewalk recall (@15 m from tile2net sidewalk lines)
    roads = to_metric(_sidewalk_roads(osm_bbox), center_lon)
    if len(roads):
        road_len = float(roads.geometry.length.sum())
        road_len_hit = 0.0
        if t2n_sides_union is not None:
            clutch = shapely.union_all(roads.geometry.values)
            hit = shapely.intersection(clutch, t2n_sides_union.buffer(15.0))
            road_len_hit = shapely.length(hit)
        road_recall = road_len_hit / road_len if road_len else None
    else:
        road_len, road_len_hit, road_recall = 0.0, 0.0, None
    out["roads_sidewalk_tagged"] = {
        "count": int(len(roads)),
        "length_m": round(road_len, 1),
        "length_with_t2n_sidewalk_within_15m_m": round(road_len_hit, 1),
        "sidewalk_recall_share": round(float(road_recall), 4) if road_recall is not None else None,
    }

    # --- candidate new edges (CANDIDATE-ONLY) + optional dump
    osm_walk_union = (
        shapely.union_all(foot.geometry.values) if len(foot) else None
    )
    t2n_union = (
        shapely.union_all(t2n_walk.geometry.values) if len(t2n_walk) else None
    )
    new_edges_gdf = None
    if t2n_union is not None:
        beyond = t2n_union if osm_walk_union is None else shapely.difference(
            t2n_union, osm_walk_union.buffer(5.0)
        )
        beyond_len = float(shapely.length(beyond))
        t2n_len = float(t2n_walk.geometry.length.sum())
        out["candidate_new_edges_CANDIDATE_ONLY"] = {
            "definition": "tile2net sidewalk/crosswalk/connector length with no OSM "
                          "sidewalk-or-footway within 5 m; includes false positives "
                          "(gutters, parking aisles, private drives) and must be "
                          "human/QA verified before router use",
            "length_m": round(beyond_len, 1),
            "share_of_tile2net": (
                round(beyond_len / t2n_len, 4) if t2n_len else None
            ),
            "tile2net_total_length_m": round(t2n_len, 1),
        }
        if len(inferred):
            mask = []
            osm_buf = osm_walk_union.buffer(5.0) if osm_walk_union is not None else None
            for geom in t2n_walk.geometry.values:
                if osm_buf is None:
                    mask.append(True)
                else:
                    inter = shapely.intersection(geom, osm_buf)
                    mask.append(shapely.length(inter) <= 1e-9)
            new_edges_gdf = t2n_walk[np.array(mask)].reset_index(drop=True)

    in_training = region.lower().strip() in TRAINING_REGIONS
    result = {
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "region": region,
        "demo_bbox": list(bbox),
        "in_training_cities": in_training,
        "training_cities": sorted(set(TRAINING_REGIONS.values())),
        **out,
        "caveat": (
            "OpenStreetMap sidewalk data is incomplete and not ground truth; "
            "these are proxy metrics, not accuracy. Tile2Net did not train on "
            "this region unless in_training_cities is true. "
            "candidate_new_edges is CANDIDATE-ONLY (unverified)."
        ),
    }
    return result, new_edges_gdf


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--inferred", required=True)
    ap.add_argument("--bbox", required=True, help="lat,lon,lat,lon (top-left then bottom-right)")
    ap.add_argument("--region", default="washington-dc",
                    help=f"key for in_training_cities check; use e.g. arlington-va for non-training")
    ap.add_argument("--out", required=True)
    ap.add_argument("--dump-new-edges", default=None,
                    help="optional GeoJSON path for the individual candidate-new-edge lines")
    args = ap.parse_args()

    bbox = tuple(float(v) for v in args.bbox.split(","))
    if len(bbox) != 4:
        raise SystemExit("--bbox must be lat,lon,lat,lon")

    try:
        (metrics, new_edges) = evaluate(args.inferred, bbox, args.region)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(metrics, indent=2) + "\n")

    if args.dump_new_edges and new_edges is not None and len(new_edges):
        p = pathlib.Path(args.dump_new_edges)
        p.parent.mkdir(parents=True, exist_ok=True)
        want = new_edges[(new_edges["kind"].isin(["sidewalk", "crosswalk"]))].reset_index(drop=True)
        want4326 = want.to_crs(4326)
        g = gpd.GeoDataFrame(
            {"kind": want4326["kind"].values, "source": "ml",
             "confidence": [None]*len(want4326)},
            geometry=want4326.geometry.values, crs=4326,
        )
        g.to_file(p, driver="GeoJSON")
        print(f"dumped {len(g)} candidate-new-edge lines -> {p}")
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
