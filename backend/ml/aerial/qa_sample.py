#!/usr/bin/env python3
"""QA sampling of candidate-new-edge segments for human review.

Randomly samples N candidate-new-edge lines (from osm_metrics.py
--dump-new-edges output) into a small GeoJSON plus a folium map and a
matplotlib PNG so reviewers can eyeball false positives.

Usage:
  python qa_sample.py --new-edges ml/aerial/qa/new_edges_demo_all.geojson \
      --out-prefix ml/aerial/qa/new_edges_sample --n 25 \
      --bbox "38.9182,-77.0380,38.9092,-77.0270"
"""
from __future__ import annotations

import argparse
import pathlib
import random
import warnings

import folium
import geopandas as gpd

with warnings.catch_warnings():
    warnings.simplefilter("ignore")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--new-edges", required=True)
    ap.add_argument("--out-prefix", required=True)
    ap.add_argument("--n", type=int, default=25)
    ap.add_argument("--bbox", required=True, help="lat,lon,lat,lon")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    gdf = gpd.read_file(args.new_edges)
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)

    rng = random.Random(args.seed)
    idx = list(range(len(gdf)))
    rng.shuffle(idx)
    sample = gdf.iloc[idx[: args.n]].reset_index(drop=True)

    sample_path = f"{args.out_prefix}.geojson"
    sample.to_file(sample_path, driver="GeoJSON")

    lat_top, lon_left, lat_bottom, lon_right = (float(v) for v in args.bbox.split(","))
    center = ((lat_top + lat_bottom) / 2, (lon_left + lon_right) / 2)
    fm = folium.Map(location=center, zoom_start=16)
    colors = {"sidewalk": "#1f77b4", "crosswalk": "#ff7f0e", "connector": "#7f7f7f",
              "footpath": "#2ca02c"}
    kind_at = lambda f: (f.get("properties") or {}).get("kind")  # noqa: E731
    style = lambda f: {"color": colors.get(kind_at(f), "#888"), "weight": 4}  # noqa: E731
    folium.GeoJson(sample.__geo_interface__, style_function=style).add_to(fm)
    fm.fit_bounds([[lat_bottom, lon_left], [lat_top, lon_right]])
    fm.save(f"{args.out_prefix}_map.html")

    print(f"sampled {len(sample)} of {len(gdf)} -> {sample_path} (map: {args.out_prefix}_map.html)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
