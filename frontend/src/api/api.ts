// Stryde backend client — one place to point at the FastAPI service.
//
// Device testing: the phone and the Mac running the backend must share Wi-Fi.
// API base resolution order:
//  1. EXPO_PUBLIC_API_URL (set before `npx expo start`)
//  2. The LAN IP the phone reached Metro via (Expo manifest hostUri), so a
//     default `npx expo start` works on physical devices with zero setup
//  3. localhost (simulator / web)
import Constants from "expo-constants";

const DEV_FALLBACK = "http://192.168.1.18:8100";
import AsyncStorage from "@react-native-async-storage/async-storage";
const PREFS_KEY = "stryde:prefs";
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host && /^\d+\.\d+\.\d+\.\d+$/.test(host)) return `http://${host}:8100`;
  return DEV_FALLBACK;
}

export const BASE_URL = resolveBaseUrl();

export type LatLng = { latitude: number; longitude: number };

export type Detection = {
  // C1 detect() contract
  class: string;
  confidence: number;
  bbox: number[]; // [x1, y1, x2, y2] px in the uploaded image
};

export type PathResult = {
  start: string;
  goal: string;
  start_node: string;
  goal_node: string;
  snap: { start_m: number; goal_m: number };
  snapped_connect_m: number;
  straight_m?: number | null; // crow-flies meters (lat,lng inputs only)
  ratio?: number | null; // total route length / straight line
  path: string[]; // node ids along the route
  cost: number; // network meters (tubes only)
  total_cut_m: number; // including the two snaps
  geometry: [number, number][]; // [lat, lng] — polyline coordinates
  // graph: { nodes: number; tubes: number };
};
export type RouteResult = {
  paths: PathResult[];
};
export type Health = {
  ok: boolean;
  weights: string | null; // null while the detector is still training
  graph: { nodes: number; tubes: number; fallback: boolean };
  coverage: string[];
};

export type ChatPreferences = {
  message: string;
  routingMode: "standard" | "wheelchair";
  preferSidewalks: boolean;
  wellLitOnly: boolean;
  lowTraffic: boolean;
  avoidObstacles: boolean;
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
        "On a physical phone, use your computer's LAN IP: EXPO_PUBLIC_API_URL=http://<mac-ip>:8100",
    );
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
    const res = await request("/health");
    return res.json();
  },

  async searchRoute(
    start: string,
    goal: string,
    prefs?: Partial<{
      mode: string;
      preferSidewalks: boolean;
      avoidObstacles: boolean;
      wellLitOnly: boolean;
      lowTraffic: boolean;
    }>,
  ): Promise<RouteResult> {
    const qs = new URLSearchParams({ start, goal });
    if (prefs) {
      if (prefs.mode) qs.set("mode", prefs.mode);
      if (prefs.preferSidewalks) qs.set("preferSidewalks", "true");
      if (prefs.avoidObstacles) qs.set("avoidObstacles", "true");
      if (prefs.wellLitOnly) qs.set("wellLitOnly", "true");
      if (prefs.lowTraffic) qs.set("lowTraffic", "true");
    }
    const res = await request(`/search?${qs}`);
    return res.json();
  },

  async chat(preferences: ChatPreferences): Promise<{
    reply: string;
    patch?: Record<string, unknown> | null;
  }> {
    const res = await request("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
    return res.json();
  },

  async getPreferences(): Promise<Record<string, unknown>> {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },
  async savePreferences(prefs: Record<string, unknown>): Promise<void> {
    try {
      const current = await api.getPreferences();
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
    } catch {
      // storage unavailable; settings just won't persist past this session
    }
  },

  async coverage(
    area: "demo" | "test" | "nova",
  ): Promise<GeoJSON.FeatureCollection> {
    const res = await request(`/coverage?area=${area}`);
    const body = (await res.json()) as { geojson: GeoJSON.FeatureCollection };
    return body.geojson;
  },

  async detectHazard(
    fileUri: string,
    conf = 0.25,
  ): Promise<{ detections: Detection[] }> {
    const data = new FormData();
    data.append("conf", String(conf));
    data.append("file", {
      uri: fileUri,
      name: "hazard.jpg",
      type: "image/jpeg",
    } as unknown as Blob);
    const res = await request("/detect", { method: "POST", body: data });
    return res.json();
  },
  async reportHazard(
    formData: FormData,
  ): Promise<{ status: string; photo_path?: string }> {
    const res = await request("/report", { method: "POST", body: formData });
    return res.json();
  },

  async listHazards(limit = 25): Promise<{ hazards: HazardReport[] }> {
    const res = await request(`/hazards?limit=${limit}`);
    return res.json();
  },
};

export type HazardReport = {
  id: number;
  ts: number;
  type: string;
  lat: number;
  lng: number;
  description: string;
  photo?: string | null;
};
