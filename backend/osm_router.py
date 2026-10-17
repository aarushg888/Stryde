"""Cached OpenStreetMap walking router used after Tile2Net coverage is loaded.

Tile2Net remains valuable as an accessibility-infrastructure layer, but its
small centerline graph is not a complete pedestrian network. This module adds
an OSM walking graph for the same coverage area. The graph is downloaded once
from Overpass, cached by OSMnx, and then routes in memory with Dijkstra.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Any

import osmnx as ox

class OSMRouterUnavailable(RuntimeError):
    """Raised when the OSM walking graph cannot be loaded or routed."""

def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance in metres between two (lat, lng) coordinates."""
    lat1, lng1 = a
    lat2, lng2 = b
    p = math.pi / 180.0
    hav = (0.5 - math.cos((lat2 - lat1) * p) / 2.0
           + math.cos(lat1 * p) * math.cos(lat2 * p)
           * (1 - math.cos((lng2 - lng1) * p)) / 2.0)
    return 12_742_000.0 * math.asin(math.sqrt(hav))

def _append_coordinate(points: list[list[float]], lat: float, lng: float) -> None:
    """Append a coordinate while avoiding duplicate polyline vertices."""
    point = [round(float(lat), 6), round(float(lng), 6)]
    if not points or points[-1] != point:
        points.append(point)

@dataclass(frozen=True)
class OSMLimits:
    south: float
    west: float
    north: float
    east: float

    def padded(self, degrees: float = 0.0025) -> tuple[float, float, float, float]:
        """OSMnx bbox order: west, south, east, north."""
        return (
            self.west - degrees,
            self.south - degrees,
            self.east + degrees,
            self.north + degrees,
        )

class OSMWalkingRouter:
    """Lazy, process-local OSM walking graph with a disk-backed HTTP cache."""

    def __init__(self, limits: OSMLimits, cache_dir: Path):
        self._limits = limits
        self._cache_dir = cache_dir
        self._graph: Any | None = None
        self._load_error: Exception | None = None
        self._lock = Lock()

    def _get_graph(self):
        if self._graph is not None:
            return self._graph
        with self._lock:
            if self._graph is not None:
                return self._graph
            if self._load_error is not None:
                raise OSMRouterUnavailable(str(self._load_error)) from self._load_error
            try:
                self._cache_dir.mkdir(parents=True, exist_ok=True)
                ox.settings.use_cache = True
                ox.settings.cache_folder = str(self._cache_dir)
                ox.settings.requests_timeout = 30
                self._graph = ox.graph_from_bbox(
                    self._limits.padded(),
                    network_type="walk",
                    simplify=True,
                    retain_all=True,
                    truncate_by_edge=True,
                )
            except Exception as exc:
                self._load_error = exc
                raise OSMRouterUnavailable(str(exc)) from exc
        return self._graph

    @staticmethod
    def _route_geometry(graph, route: list[int], start: tuple[float, float], goal: tuple[float, float]) -> list[list[float]]:
        """Build a road-shaped [lat,lng] polyline including the exact POI ends."""
        points: list[list[float]] = []
        _append_coordinate(points, *start)
        
        # Optimized geometry extraction
        try:
            edge_rows = ox.routing.route_to_gdf(graph, route, weight="length")
            has_geometry = False
            for _, edge in edge_rows.iterrows():
                geometry = edge.get("geometry")
                if geometry is None:
                    continue
                has_geometry = True
                for lng, lat in geometry.coords:
                    _append_coordinate(points, lat, lng)
            
            if not has_geometry:
                for node in route:
                    attrs = graph.nodes[node]
                    _append_coordinate(points, attrs["y"], attrs["x"])
        except Exception:
            # Fallback to node coordinates if GDF fails
            for node in route:
                attrs = graph.nodes[node]
                _append_coordinate(points, attrs["y"], attrs["x"])

        _append_coordinate(points, *goal)
        return points

    def route(self, start: tuple[float, float], goal: tuple[float, float]) -> dict:
        """Route exact endpoints through OSM's pedestrian network."""
        try:
            graph = self._get_graph()
            # Use faster nearest_nodes implementation
            start_node = ox.distance.nearest_nodes(graph, X=start[1], Y=start[0])
            goal_node = ox.distance.nearest_nodes(graph, X=goal[1], Y=goal[0])
            
            path = ox.routing.shortest_path(
                graph,
                start_node,
                goal_node,
                weight="length",
                cpus=1,
            )
            if not path:
                raise OSMRouterUnavailable("no pedestrian path between those locations")
            
            edge_rows = ox.routing.route_to_gdf(graph, path, weight="length")
            cost = float(edge_rows["length"].sum())
            
            start_snap = (float(graph.nodes[start_node]["y"]), float(graph.nodes[start_node]["x"]))
            goal_snap = (float(graph.nodes[goal_node]["y"]), float(graph.nodes[goal_node]["x"]))
            
            return {
                "engine": "openstreetmap",
                "path": [str(node) for node in path],
                "cost": round(cost, 1),
                "total_cut_m": round(cost + haversine_m(start, start_snap) + haversine_m(goal, goal_snap), 1),
                "snap": {
                    "start_m": round(haversine_m(start, start_snap), 1),
                    "goal_m": round(haversine_m(goal, goal_snap), 1),
                },
                "snapped_points": {
                    "start": [round(start_snap[0], 6), round(start_snap[1], 6)],
                    "goal": [round(goal_snap[0], 6), round(goal_snap[1], 6)],
                },
                "start_node": str(start_node),
                "goal_node": str(goal_node),
                "geometry": self._route_geometry(graph, path, start, goal),
            }
        except OSMRouterUnavailable:
            raise
        except Exception as exc:
            raise OSMRouterUnavailable(str(exc)) from exc
