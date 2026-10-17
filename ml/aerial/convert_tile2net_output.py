#!/usr/bin/env python3
"""Convert tile2net vector outputs to the router contract GeoJSON.

Reads the GeoParquet files tile2net's inference step writes:
  <project-dir>/network/<project-name>-network.parquet   (LineStrings, EPSG:4326)
  <project-dir>/polygons/<project-name>-polygons.parquet (Polygons, EPSG:4326)

Writes LineString / Polygon GeoJSON in EPSG:4326 with properties
  {"source": "ml", "kind": "sidewalk"|"crosswalk"|"footpath", "confidence": null}

tile2net exposes no per-feature softmax/confidence in its vector outputs, so
confidence is always null (documented in SETUP.md; never invented).

Excluded f_type values (tile2net artifacts, not detected features):
  network: sidewalk_connection, medians
  polygons: road
"""
from __future__ import annotations

import argparse
import pathlib
import sys

import geopandas as gpd

KIND_MAP = {
    "sidewalk": "sidewalk",
    "crosswalk": "crosswalk",
    "footpath": "footpath",
    # tile2net artifacts that are not detected features:
    "sidewalk_connection": None,
    "medians": None,
    "road": None,
}


def _to_4326(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    if gdf.crs is None:
        return gdf.set_crs(4326)
    if gdf.crs.to_epsg() != 4326:
        return gdf.to_crs(4326)
    return gdf


def _map_kinds(gdf: gpd.GeoDataFrame, layer: str) -> gpd.GeoDataFrame:
    if "f_type" not in gdf.columns:
        raise ValueError(
            f"{layer} parquet has no f_type column: columns={list(gdf.columns)}"
        )
    kinds = gdf["f_type"].map(KIND_MAP)
    unknown = sorted(set(gdf["f_type"].unique()) - set(KIND_MAP))
    if unknown:
        print(f"WARNING: unknown f_type values excluded: {unknown}", file=sys.stderr)
    gdf = gdf[kinds.notna()].copy()
    gdf["kind"] = kinds[kinds.notna()]
    return gdf


def _contract_gdf(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    out = gpd.GeoDataFrame(
        {
            "source": "ml",
            "kind": gdf["kind"].values,
            "confidence": [None] * len(gdf),
        },
        geometry=gdf.geometry.values,
        crs=4326,
    )
    return out


def convert_project(
        project_dir: str | pathlib.Path,
        project_name: str,
        inferred_out: str | pathlib.Path,
        polygons_out: str | pathlib.Path,
) -> tuple[int, int]:
    """Returns (n_lines_written, n_polygons_written)."""
    project_dir = pathlib.Path(project_dir)
    net_path = project_dir / "network" / f"{project_name}-network.parquet"
    pol_path = project_dir / "polygons" / f"{project_name}-polygons.parquet"

    if not net_path.exists() and not pol_path.exists():
        raise FileNotFoundError(
            f"Neither {net_path} nor {pol_path} found; "
            f"check --project-dir/--project-name."
        )

    n_lines = n_polys = 0

    if net_path.exists():
        net = _map_kinds(_to_4326(gpd.read_parquet(net_path)), "network")
        lines = _contract_gdf(net)
        if len(lines):
            # split MultiLineString parts so the router only sees LineStrings
            lines = lines.explode(index_parts=False).reset_index(drop=True)
            lines = lines[lines.geometry.geom_type == "LineString"]
        if len(lines):
            inferred_out = pathlib.Path(inferred_out)
            inferred_out.parent.mkdir(parents=True, exist_ok=True)
            lines.to_file(inferred_out, driver="GeoJSON")
            n_lines = len(lines)
        else:
            print("WARNING: no line features in network parquet", file=sys.stderr)

    if pol_path.exists():
        pol = _map_kinds(_to_4326(gpd.read_parquet(pol_path)), "polygons")
        polys = _contract_gdf(pol)
        if len(polys):
            polygons_out = pathlib.Path(polygons_out)
            polygons_out.parent.mkdir(parents=True, exist_ok=True)
            polys.to_file(polygons_out, driver="GeoJSON")
            n_polys = len(polys)
        else:
            print("WARNING: no polygon features in polygons parquet", file=sys.stderr)

    return n_lines, n_polys


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
    args = ap.parse_args()

    n_lines, n_polys = convert_project(
        args.project_dir, args.project_name, args.inferred, args.polygons
    )
    print(f"wrote {n_lines} line features -> {args.inferred}")
    print(f"wrote {n_polys} polygon features -> {args.polygons}")
    if n_lines == 0 and n_polys == 0:
        print("WARNING: both outputs empty; check tile2net inference logs", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
