import type { RouteResult } from "@/api/api";

export type LatLng = { latitude: number; longitude: number };

// MVP coverage area kept in sync with the backend's built graph (Logan Circle).
export const DC_REGION = {
  latitude: 38.9137,
  longitude: -77.0325,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

const WALK_SPEED_KMH = 4.5;

export function parseLatLng(value: string): LatLng | null {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);

  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;

  return valid ? { latitude, longitude } : null;
}

export type RoutePath = RouteResult["paths"][number];

export function toPolyline(path: RoutePath): LatLng[] {
  return path.geometry.map(([latitude, longitude]) => ({
    latitude,
    longitude,
  }));
}

export function getRouteStats(path: RoutePath) {
  const km = path.total_cut_m / 1000;
  const minutes = Math.max(1, Math.round((km / WALK_SPEED_KMH) * 60));
  return { km, minutes };
}
