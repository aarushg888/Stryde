#!/usr/bin/env python3
"""Build preview maps (folium HTML + matplotlib PNG) from contract GeoJSONs.

Usage:
  python make_previews.py --inferred data/x_inferred.geojson \
      --polygons data/x_polygons.geojson \
      --bbox "lat,lon,lat,lon" --name test_area --out ml/aerial/previews
"""
from __future__ import annotations

import argparse
import pathlib
import warnings

import folium
import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import shapely

KIND_COLORS = {
    "sidewalk": "#1f77b4",
    "crosswalk": "#ff7f0e",
    "footpath": "#2ca02c",
}


def _load(path: str | pathlib.Path, crs=4326) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(crs)
    elif gdf.crs.to_epsg() != crs:
        gdf = gdf.to_crs(crs)
    return gdf


def build(
        inferred_path: str,
        polygons_path: str | None,
        bbox: tuple[float, float, float, float],
        name: str,
        out_dir: str | pathlib.Path,
) -> tuple[pathlib.Path, pathlib.Path]:
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    lat_top, lon_left, lat_bottom, lon_right = bbox
    center = ((lat_top + lat_bottom) / 2.0, (lon_left + lon_right) / 2.0)

    fmap = folium.Map(location=center, zoom_start=16)
    bbox_poly = folium.Polygon(
        locations=[(lat_top, lon_left), (lat_top, lon_right),
                   (lat_bottom, lon_right), (lat_bottom, lon_left)],
        color="black", weight=2, fill=False, tooltip="bbox",
    )
    bbox_poly.add_to(fmap)

    kind_of = lambda feature: ((feature or {}).get("properties") or {}).get("kind")  # noqa: E731

    if inferred_path and pathlib.Path(inferred_path).exists():
        lines = _load(inferred_path)
        style = lambda feature: {  # noqa: E731
            "color": KIND_COLORS.get(kind_of(feature), "#888888"),
            "weight": 3,
        }
        folium.GeoJson(lines.__geo_interface__, style_function=style,
                       name="centerlines").add_to(fmap)
    if polygons_path and pathlib.Path(polygons_path).exists():
        polys = _load(polygons_path)
        pstyle = lambda feature: {  # noqa: E731
            "color": KIND_COLORS.get(kind_of(feature), "#888888"),
            "weight": 1, "fillOpacity": 0.25,
        }
        folium.GeoJson(polys.__geo_interface__, style_function=pstyle,
                       name="polygons").add_to(fmap)
    folium.LayerControl().add_to(fmap)
    fmap.fit_bounds([[lat_bottom, lon_left], [lat_top, lon_right]])

    html_path = out_dir / f"{name}_preview.html"
    fmap.save(html_path)

    # matplotlib PNG (no basemap dependency)
    fig, ax = plt.subplots(figsize=(8, 8))
    bbox_gdf = gpd.GeoDataFrame(
        geometry=[shapely.box(lon_left, lat_bottom, lon_right, lat_top)], crs=4326
    )
    bbox_gdf.boundary.plot(ax=ax, color="black", linewidth=1)
    if polygons_path and pathlib.Path(polygons_path).exists():
        polys = _load(polygons_path)
        for kind, sub in polys.groupby("kind"):
            sub.boundary.plot(ax=ax, color=KIND_COLORS.get(kind, "#888"),
                              linewidth=0.4, label=f"{kind} (poly)")
    if inferred_path and pathlib.Path(inferred_path).exists():
        lines = _load(inferred_path)
        for kind, sub in lines.groupby("kind"):
            sub.plot(ax=ax, color=KIND_COLORS.get(kind, "#888"), linewidth=1.2,
                     label=f"{kind} (line)")
    ax.legend(loc="lower right", fontsize=7)
    ax.set_axis_off()
    png_path = out_dir / f"{name}_preview.png"
    fig.savefig(png_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    return html_path, png_path


def main() -> int:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ap = argparse.ArgumentParser(
            description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
        )
        ap.add_argument("--inferred", required=True)
        ap.add_argument("--polygons", default=None)
        ap.add_argument("--bbox", required=True, help="lat,lon,lat,lon")
        ap.add_argument("--name", required=True)
        ap.add_argument("--out", required=True)
        args = ap.parse_args()

        bbox = tuple(float(v) for v in args.bbox.split(","))
        if len(bbox) != 4:
            raise SystemExit("--bbox must be lat,lon,lat,lon")
        html_path, png_path = build(
            args.inferred, args.polygons, bbox, args.name, args.out
        )
        print(f"wrote {html_path}\nwrote {png_path}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
