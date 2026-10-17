import type { Profile } from './profiles';

export type LatLng = { latitude: number; longitude: number };

export type Route = {
  id: 'standard' | 'accessible';
  label: string;
  coords: LatLng[];
  distanceM: number;
  durationS: number;
  demo: boolean; // true = fake placeholder route, not real routing
  // Data we do not have yet. Screens must show "Not available yet" when these
  // are null. Never invent values for them.
  sidewalkInfo: string | null;
  crossingInfo: string | null;
  accessibilityNote: string | null;
};

export type Place = { label: string; coords: LatLng };

// Preference-derived limits for the wheelchair-accessible route.
export type AccessibilityLimits = {
  maxInclinePct: number; // ORS maximum_incline, percent
  maxKerbM: number; // ORS maximum_sloped_kerb, meters
  pavedOnly: boolean;
};

const KEY = process.env.EXPO_PUBLIC_ORS_KEY;
export const hasRoutingKey = !!KEY;

const ORS = 'https://api.openrouteservice.org';

export async function searchPlaces(text: string, near: LatLng | null): Promise<Place[]> {
  if (!KEY || !text.trim()) return [];
  const focus = near
    ? `&focus.point.lon=${near.longitude}&focus.point.lat=${near.latitude}`
    : '';
  const url = `${ORS}/geocode/search?api_key=${KEY}&size=4&text=${encodeURIComponent(text)}${focus}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Search failed');
  const json = await res.json();
  return (json.features ?? []).map((f: any) => ({
    label: f.properties.label as string,
    coords: { latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0] },
  }));
}

function orsRestrictions(limits?: AccessibilityLimits) {
  return {
    // ORS defaults, tightened by the user's preferences.
    maximum_incline: limits?.maxInclinePct ?? 6,
    maximum_sloped_kerb: limits?.maxKerbM ?? 0.06,
    ...(limits?.pavedOnly ? { surface_type: 'paved' } : {}),
  };
}

async function fetchRoute(
  from: LatLng,
  to: LatLng,
  orsProfile: 'foot-walking' | 'wheelchair',
  limits?: AccessibilityLimits,
): Promise<Omit<Route, 'id' | 'label' | 'demo'>> {
  const body: any = {
    coordinates: [
      [from.longitude, from.latitude],
      [to.longitude, to.latitude],
    ],
  };
  if (orsProfile === 'wheelchair') {
    body.options = {
      profile_params: { restrictions: orsRestrictions(limits) },
    };
  }
  const res = await fetch(`${ORS}/v2/directions/${orsProfile}/geojson`, {
    method: 'POST',
    headers: { Authorization: KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Routing failed (${res.status})`);
  const json = await res.json();
  const feature = json.features[0];
  return {
    coords: feature.geometry.coordinates.map(([lng, lat]: number[]) => ({
      latitude: lat,
      longitude: lng,
    })),
    distanceM: feature.properties.summary.distance,
    durationS: feature.properties.summary.duration,
    sidewalkInfo: null, // needs a sidewalk dataset
    crossingInfo: null, // needs crossing data
    accessibilityNote: null, // needs survey data
  };
}

// --- Demo mode (no API key): a gently curved line so the UI can be built and tested. ---

function haversine(a: LatLng, b: LatLng) {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function demoRoute(from: LatLng, to: LatLng, bend: number): Omit<Route, 'id' | 'label' | 'demo'> {
  const steps = 24;
  const coords: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const offset = Math.sin(Math.PI * t) * bend;
    coords.push({
      latitude: from.latitude + (to.latitude - from.latitude) * t + offset,
      longitude: from.longitude + (to.longitude - from.longitude) * t - offset,
    });
  }
  let dist = 0;
  for (let i = 1; i < coords.length; i++) dist += haversine(coords[i - 1], coords[i]);
  return {
    coords,
    distanceM: dist,
    durationS: dist / 1.3,
    sidewalkInfo: null,
    crossingInfo: null,
    accessibilityNote: null,
  };
}

export async function getRoutes(
  from: LatLng,
  to: LatLng,
  profile: Profile,
  limits?: AccessibilityLimits,
): Promise<Route[]> {
  const wantsAccessible = profile.orsProfile !== null;

  if (!KEY) {
    const routes: Route[] = [
      { id: 'standard', label: 'Standard', demo: true, ...demoRoute(from, to, 0.0006) },
    ];
    if (wantsAccessible) {
      routes.push({
        id: 'accessible',
        label: profile.label,
        demo: true,
        ...demoRoute(from, to, -0.0009),
      });
    }
    return routes;
  }

  const [standard, accessible] = await Promise.all([
    fetchRoute(from, to, 'foot-walking'),
    wantsAccessible ? fetchRoute(from, to, 'wheelchair', limits) : Promise.resolve(null),
  ]);
  const routes: Route[] = [{ id: 'standard', label: 'Standard', demo: false, ...standard }];
  if (accessible) {
    routes.push({ id: 'accessible', label: profile.label, demo: false, ...accessible });
  }
  return routes;
}

function pointLineMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const toXY = (c: LatLng) => ({
    x: rad(c.longitude) * R * Math.cos(rad((a.latitude + b.latitude) / 2)),
    y: rad(c.latitude) * R,
  });
  const P = toXY(p);
  const A = toXY(a);
  const B = toXY(b);
  const abx = B.x - A.x;
  const aby = B.y - A.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(P.x - A.x, P.y - A.y);
  const t = Math.max(0, Math.min(1, ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2));
  return Math.hypot(P.x - (A.x + t * abx), P.y - (A.y + t * aby));
}

/** Hazards within `withinM` meters of any point on the route. */
export function hazardsNearRoute(
  route: Route,
  hazards: { coords: LatLng; id: string }[],
  withinM = 40,
): string[] {
  const near: { id: string; d: number }[] = [];
  if (route.coords.length < 2) return [];
  for (const h of hazards) {
    let best = Infinity;
    for (let i = 1; i < route.coords.length; i++) {
      best = Math.min(best, pointLineMeters(h.coords, route.coords[i - 1], route.coords[i]));
    }
    if (best <= withinM) near.push({ id: h.id, d: best });
  }
  return near.sort((a, b) => a.d - b.d).map((n) => n.id);
}

export function formatDistance(m: number) {
  const mi = m / 1609.34;
  return mi < 0.1 ? `${Math.round(m * 3.281)} ft` : `${mi.toFixed(1)} mi`;
}

export function formatDuration(s: number) {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
