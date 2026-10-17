import type { Profile } from './profiles';

export type LatLng = { latitude: number; longitude: number };

export type Route = {
  id: 'standard' | 'accessible';
  label: string;
  coords: LatLng[];
  distanceM: number;
  durationS: number;
  demo: boolean; // true = fake placeholder route, not real routing
};

export type Place = { label: string; coords: LatLng };

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

async function fetchRoute(
  from: LatLng,
  to: LatLng,
  orsProfile: 'foot-walking' | 'wheelchair',
): Promise<Omit<Route, 'id' | 'label' | 'demo'>> {
  const body: any = {
    coordinates: [
      [from.longitude, from.latitude],
      [to.longitude, to.latitude],
    ],
  };
  if (orsProfile === 'wheelchair') {
    body.options = {
      profile_params: { restrictions: { maximum_incline: 6, maximum_sloped_kerb: 0.06 } },
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
  return { coords, distanceM: dist, durationS: dist / 1.3 };
}

export async function getRoutes(from: LatLng, to: LatLng, profile: Profile): Promise<Route[]> {
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
    wantsAccessible ? fetchRoute(from, to, 'wheelchair') : Promise.resolve(null),
  ]);
  const routes: Route[] = [{ id: 'standard', label: 'Standard', demo: false, ...standard }];
  if (accessible) {
    routes.push({ id: 'accessible', label: profile.label, demo: false, ...accessible });
  }
  return routes;
}

export function formatDistance(m: number) {
  const mi = m / 1609.34;
  return mi < 0.1 ? `${Math.round(m * 3.281)} ft` : `${mi.toFixed(1)} mi`;
}

export function formatDuration(s: number) {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
