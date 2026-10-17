#!/usr/bin/env python3
"""Compare tile2net output against OpenStreetMap for the demo bbox (CPU).

Computes:
  (a) share of OSM sidewalk/crossing length within 3 m of tile2net centerlines
      (a recall proxy);
  (b) share of tile2net sidewalk/crosswalk length with no OSM sidewalk or
      footway way within 5 m (candidate new edges for the router);
  (c) in_training_cities: whether the demo area is inside a DC / Boston /
      Cambridge / NYC area where tile2net was trained (results optimistic
      there).

Caveats documented in the output JSON: OSM sidewalk data is incomplete and is
not ground truth; metrics are proxy estimates.

Usage:
  python osm_metrics.py --inferred data/demo_area_inferred.geojson \
      --bbox "38.9162,-77.0340,38.9142,-77.0310" \
      --region "washington-dc" --out metrics/aerial_vs_osm.json
"""
from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import sys

import geopandas as gpd
import osmnx as ox
import shapely

CROSSWALK_KINDS = {"crosswalk"}
WALK_KINDS = {"sidewalk", "footpath", "crosswalk"}

TRAINING_REGIONS = {
    "washington-dc": "DC",
    "boston": "Boston, MA",
    "cambridge": "Cambridge, MA",
    "nyc": "New York, NY",
    "new-york-city": "New York, NY",
    "manhattan": "New York, NY",
}


def project_to_metric(gdf: gpd.GeoDataFrame | gpd.GeoSeries, lon: float) -> gpd.GeoDataFrame:
    utm_epsg = int(int((lon + 180) // 6) + 32601)  # rough UTM zone from longitude
    return gdf.to_crs(utm_epsg)


def osm_sidewalk_ways(bbox: tuple[float, float, float, float]) -> gpd.GeoDataFrame:
    """bbox = (lat_top, lon_left, lat_bottom, lon_right).

    Returns ways tagged as sidewalk-equivalent (footway=sidewalk / bare
    highway=footway) or crossings (footway=crossing), as LineStrings only.
    """
    lat_top, lon_left, lat_bottom, lon_right = bbox
    west, bottom, east, top = lon_left, lat_bottom, lon_right, lat_top
    foot = ox.features_from_bbox(
        bbox=(west, bottom, east, top),
        tags={"highway": ["footway"]},
    )
    foot = foot.reset_index()
    elem_col = "element_type" if "element_type" in foot.columns else "element"
    foot = foot[foot[elem_col] == "way"]
    foot = foot[foot.geometry.geom_type.isin(["LineString", "MultiLineString"])]
    footway_col = foot.get("footway", "").astype(str)
    is_sidewalk = (footway_col == "sidewalk") | (
            (footway_col == "nan") & (foot.get("highway", "").astype(str) == "footway")
    )
    is_crossing = footway_col == "crossing"
    out = foot[is_sidewalk | is_crossing].copy()
    out["osm_kind"] = ["crosswalk" if c else "sidewalk"
                       for c in is_crossing[is_sidewalk | is_crossing]]
    keep = ["osm_kind", "highway", "footway", "crossing", "geometry"]
    return gpd.GeoDataFrame(out[keep], crs=out.crs)


def evaluate(inferred_path: str | pathlib.Path, bbox, region: str) -> dict:
    lat_top, lon_left, lat_bottom, lon_right = bbox
    center_lon = (lon_left + lon_right) / 2.0

    inferred = gpd.read_file(inferred_path)
    if inferred.crs is None:
        inferred = inferred.set_crs(4326)
    elif inferred.crs.to_epsg() != 4326:
        inferred = inferred.to_crs(4326)

    osm = osm_sidewalk_ways(bbox)

    T2N = project_to_metric(inferred, center_lon)
    OSMP = project_to_metric(osm, center_lon)

    t2n_walk = T2N[T2N["kind"].isin(WALK_KINDS)]
    osm_walk = OSMP[OSMP["osm_kind"].isin(WALK_KINDS)]
    t2n_union = shapely.union_all(t2n_walk.geometry.values) if len(t2n_walk) else None
    osm_union = shapely.union_all(osm_walk.geometry.values) if len(osm_walk) else None

    m: dict = {}
    m["osm_sidewalk_crossing_length_m"] = float(osm_walk.geometry.length.sum()) if len(osm_walk) else 0.0
    m["tile2net_sidewalk_crosswalk_length_m"] = float(t2n_walk.geometry.length.sum()) if len(t2n_walk) else 0.0

    if t2n_union is not None and osm_union is not None:
        within3 = shapely.intersection(osm_union, t2n_union.buffer(3.0))
        m["osm_length_within_3m_of_tile2net_m"] = float(shapely.length(within3))
        beyond5 = shapely.difference(t2n_union, osm_union.buffer(5.0))
        m["tile2net_length_without_osm_within_5m_m"] = float(shapely.length(beyond5))
    elif t2n_union is not None:
        # nothing on the OSM side -> all tile2net length is "new"
        m["osm_length_within_3m_of_tile2net_m"] = 0.0
        m["tile2net_length_without_osm_within_5m_m"] = float(shapely.length(t2n_union))

    denom = m.get("osm_sidewalk_crossing_length_m") or 0.0
    m["osm_recall_proxy_share"] = (
        round(m.get("osm_length_within_3m_of_tile2net_m", 0.0) / denom, 4)
        if denom else None
    )
    denom2 = m.get("tile2net_sidewalk_crosswalk_length_m") or 0.0
    m["tile2net_new_edge_share"] = (
        round(m.get("tile2net_length_without_osm_within_5m_m", 0.0) / denom2, 4)
        if denom2 else None
    )

    in_training = region.lower().strip() in TRAINING_REGIONS
    return {
        "generated_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "region": region,
        "demo_bbox": list(bbox),
        "osm_sidewalk_ways": int(len(osm_walk)),
        "tile2net_lines": int(len(t2n_walk)),
        "in_training_cities": in_training,
        "training_cities": sorted(set(TRAINING_REGIONS.values())),
        **m,
        "caveat": (
            "OpenStreetMap sidewalk data is incomplete and is not ground truth; "
            "these are proxy metrics, not accuracy measurements."
        ),
    }


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--inferred", required=True, help="contract centerline GeoJSON")
    ap.add_argument("--bbox", required=True, help="lat,lon,lat,lon (top-left then bottom-right)")
    ap.add_argument("--region", default="washington-dc",
                    help=f"one of {', '.join(sorted(TRAINING_REGIONS))}")
    ap.add_argument("--out", required=True, help="metrics JSON output path")
    args = ap.parse_args()

    bbox = tuple(float(v) for v in args.bbox.split(","))
    if len(bbox) != 4:
        raise SystemExit("--bbox must be four comma-separated numbers lat,lon,lat,lon")

    try:
        metrics = evaluate(args.inferred, bbox, args.region)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps(metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
