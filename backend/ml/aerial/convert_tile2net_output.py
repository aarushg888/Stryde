#!/usr/bin/env python3
"""Convert tile2net vector outputs to the router contract GeoJSON.

Reads the GeoParquet files tile2net's inference step writes:
  <project-dir>/network/<project-name>-network.parquet   (LineStrings, EPSG:4326)
  <project-dir>/polygons/<project-name>-polygons.parquet (Polygons, EPSG:4326)

Writes LineString / Polygon GeoJSON in EPSG:4326 with properties
  {"source": "ml", "kind": "sidewalk"|"crosswalk"|"footpath"|"connector",
   "confidence": null}

tile2net exposes no per-feature softmax/confidence in its vector outputs, so
confidence is always null (documented in SETUP.md; never invented).

Excluded f_type values (not detected walkable features):
  polygons: road, medians
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import geopandas as gpd
import numpy as np
import shapely

LINE_KINDS = {
    "sidewalk": "sidewalk",
    "crosswalk": "crosswalk",
    "footpath": "footpath",
    # tile2net-generated stitching lines — kept as kind "connector"
    "sidewalk_connection": "connector",
}
POLYGON_KINDS = {
    "sidewalk": "sidewalk",
    "crosswalk": "crosswalk",
    "footpath": "footpath",
}


def _to_4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs(4326)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs(4326)
    return gdf


def _map_kinds(gdf: gpd.GeoDataFrame, layer: str, kind_map: dict) -> gpd.GeoDataFrame:
    if "f_type" not in gdf.columns:
        raise ValueError(
            f"{layer} parquet has no f_type column: columns={list(gdf.columns)}"
        )
    kinds = gdf["f_type"].map(kind_map)
    unknown = sorted(set(gdf["f_type"].unique()) - set(kind_map))
    if unknown:
        print(f"INFO: excluded f_type values: {unknown}", file=sys.stderr)
    keep = kinds.notna()
    gdf = gdf[keep].copy()
    gdf["kind"] = kinds[keep].values
    return gdf


def _contract_gdf(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {"source": "ml", "kind": gdf["kind"].values, "confidence": [None] * len(gdf)},
        geometry=gdf.geometry.values,
        crs=4326,
    )


def _metric(gdf: gpd.GeoDataFrame, lon: float) -> gpd.GeoDataFrame:
    zone = int((lon + 180) // 6) + 32601
    return gdf.to_crs(zone)


def collapse_crosswalks(lines: gpd.GeoDataFrame, threshold: float = 1.5) -> gpd.GeoDataFrame:
    """Cluster near-duplicate parallel crosswalk centerlines within
    `threshold` meters (metric) and keep the longest line per cluster.
    Returns the filtered GeoDataFrame (all kinds); crosswalk count before/after
    is reported by the caller via len() diffs.
    """
    import math

    lon = (lines.total_bounds[0] + lines.total_bounds[2]) / 2.0
    zone = int((lon + 180) // 6) + 32601
    metric = lines.to_crs(zone)

    geoms = metric.geometry.values
    keep = np.ones(len(geoms), dtype=bool)

    is_cw = metric["kind"].values == "crosswalk"
    cw_idx = np.where(is_cw)[0]
    if len(cw_idx) <= 1:
        return lines

    buffers = [g.buffer(threshold / 2.0) if g is not None else None for g in geoms]
    tree = shapely.STRtree([b for b in buffers if b is not None])

    # union-find over crosswalk lines whose buffers intersect
    parent = list(range(len(geoms)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in cw_idx:
        if buffers[i] is None:
            continue
        for j in tree.query(buffers[i]):
            j = int(j)
            if i >= j or not is_cw[j] or buffers[j] is None:
                continue
            if buffers[i].intersects(buffers[j]):
                ri, rj = find(i), find(j)
                if ri != rj:
                    parent[rj] = ri

    clusters: dict[int, list[int]] = {}
    for i in cw_idx:
        clusters.setdefault(find(int(i)), []).append(int(i))

    dropped = 0
    for members in clusters.values():
        if len(members) <= 1:
            continue
        member_lengths = [geoms[m].length if geoms[m] is not None else 0 for m in members]
        best = members[int(np.argmax(member_lengths))]
        for m in members:
            if m != best:
                keep[m] = False
                dropped += 1

    if dropped:
        print(f"INFO: collapsed {dropped} near-duplicate crosswalk lines "
              f"({len(cw_idx)} -> {len(cw_idx) - dropped} in clusters)", file=sys.stderr)
    return lines[keep], dropped


def convert_project(
        project_dir: str | pathlib.Path,
        project_name: str,
        inferred_out: str | pathlib.Path,
        polygons_out: str | pathlib.Path,
                collapse_cw: bool = False,
) -> tuple[int, int, int]:
    """Returns (n_lines_written, n_polygons_written, n_dropped_duplicates)."""
    project_dir = pathlib.Path(project_dir)
    net_path = project_dir / "network" / f"{project_name}-network.parquet"
    pol_path = project_dir / "polygons" / f"{project_name}-polygons.parquet"

    if not net_path.exists() and not pol_path.exists():
        raise FileNotFoundError(
            f"Neither {net_path} nor {pol_path} found; "
            f"check --project-dir/--project-name."
        )

    n_polys = n_dropped = 0

    if net_path.exists():
        net = _map_kinds(_to_4326(gpd.read_parquet(net_path)), "network", LINE_KINDS)
        lines = _contract_gdf(net)
        if len(lines):
            lines = lines.explode(index_parts=False).reset_index(drop=True)
            lines = lines[lines.geometry.geom_type == "LineString"]
            if collapse_cw:
                lines, dropped_cw = collapse_crosswalks(lines)
                n_dropped = dropped_cw
        if len(lines):
            inferred_out = pathlib.Path(inferred_out)
            inferred_out.parent.mkdir(parents=True, exist_ok=True)
            lines.to_file(inferred_out, driver="GeoJSON")
            n_lines = len(lines)
        else:
            print("WARNING: no line features in network parquet", file=sys.stderr)
            n_lines = 0

    if pol_path.exists():
        pol = _map_kinds(_to_4326(gpd.read_parquet(pol_path)), "polygons", POLYGON_KINDS)
        polys = _contract_gdf(pol)
        if len(polys):
            polygons_out = pathlib.Path(polygons_out)
            polygons_out.parent.mkdir(parents=True, exist_ok=True)
            polys.to_file(polygons_out, driver="GeoJSON")
            n_polys = len(polys)
        else:
            print("WARNING: no polygon features in polygons parquet", file=sys.stderr)

    return n_lines, n_polys, n_dropped


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--project-dir", required=True,
                    help="tile2net output dir for one project (contains network/ and polygons/)")
    ap.add_argument("--project-name", required=True,
                    help="project name used with tile2net generate -n")
    ap.add_argument("--inferred", required=True,
                    help="output GeoJSON path for the centerline network")
    ap.add_argument("--polygons", required=True,
                    help="output GeoJSON path for the polygons")
    ap.add_argument("--collapse-crosswalks", action="store_true",
                    help="collapse near-duplicate parallel crosswalk centerlines "
                         "(cluster within ~1.5 m, keep the longest of each cluster)")
    args = ap.parse_args()

    n_lines, n_polys, n_dropped = convert_project(
        args.project_dir, args.project_name, args.inferred, args.polygons,
        collapse_cw=args.collapse_crosswalks,
    )
    print(f"wrote {n_lines} line features -> {args.inferred}")
    print(f"wrote {n_polys} polygon features -> {args.polygons}")
    if args.collapse_crosswalks:
        print(f"collapsed {n_dropped} duplicate crosswalk lines")
    if n_lines == 0 and n_polys == 0:
        print("WARNING: both outputs empty; check tile2net inference logs", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
