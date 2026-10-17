// Stryde backend client — one place to point at the FastAPI service.
//
// Device testing: the phone and the Mac running the backend must share Wi-Fi.
// Set EXPO_PUBLIC_API_URL=http://<your-mac-lan-ip>:8100 (Expo env var) or edit
// DEV_FALLBACK below. On the web / simulator the default bounceback works.
const DEV_FALLBACK = 'http://localhost:8100';
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? DEV_FALLBACK;

export type LatLng = { latitude: number; longitude: number };

export type Detection = {
  // C1 detect() contract
  class: string;
  confidence: number;
  bbox: number[]; // [x1, y1, x2, y2] px in the uploaded image
};

export type RouteResult = {
  start: string;
  goal: string;
  start_node: string;
  goal_node: string;
  snap: { start_m: number; goal_m: number };
  snapped_connect_m: number;
  path: string[]; // node ids along the route
  cost: number; // network meters (tubes only)
  total_cut_m: number; // including the two snaps
  geometry: [number, number][]; // [lat, lng] — polyline coordinates
  graph: { nodes: number; tubes: number };
};

export type Health = {
  ok: boolean;
  weights: string | null; // null while the detector is still training
  graph: { nodes: number; tubes: number; fallback: boolean };
  coverage: string[];
};

/**
 * Wrapper so connection failures (phone hitting `localhost`, backend down) come
 * back as one clear, actionable message instead of a bare TypeError.
 */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, init);
  } catch {
    throw new Error(
      `Cannot reach the backend at ${BASE_URL}. Start it: uvicorn backend.main:app --host 0.0.0.0 --port 8100. ` +
      "On a physical phone, use your computer's LAN IP: EXPO_PUBLIC_API_URL=http://<mac-ip>:8100");
  }
  if (!res.ok) await parseError(res);
  return res;
}

async function parseError(res: Response): Promise<never> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { detail?: string };
    if (body?.detail) detail = body.detail;
  } catch {
    // keep the status-line fallback
  }
  throw new Error(detail);
}

export const api = {
  baseUrl: BASE_URL,

  async health(): Promise<Health> {
    const res = await request('/health');
    return res.json();
  },

  async searchRoute(start: string, goal: string): Promise<RouteResult> {
    const qs = new URLSearchParams({ start, goal });
    const res = await request(`/search?${qs}`);
    return res.json();
  },

  async coverage(area: 'demo' | 'test' | 'nova'): Promise<GeoJSON.FeatureCollection> {
    const res = await request(`/coverage?area=${area}`);
    const body = (await res.json()) as { geojson: GeoJSON.FeatureCollection };
    return body.geojson;
  },

  async detectHazard(fileUri: string, conf = 0.25): Promise<{ detections: Detection[] }> {
    const data = new FormData();
    data.append('conf', String(conf));
    data.append('file', { uri: fileUri, name: 'hazard.jpg', type: 'image/jpeg' } as unknown as Blob);
    const res = await request('/detect', { method: 'POST', body: data });
    return res.json();
  },
};
