import type { Hazard, HazardType, NewHazard } from './hazards';

//Point EXPO_PUBLIC_API_URL at the backend base URL. For an emulator talking to
// a backend running on your computer, that is http://10.0.2.2:8000 (10.0.2.2 is
// the emulator's name for your machine's localhost). Set in frontend/.env.
// Without it the app runs fully offline and keeps reports on the device.
const BASE = process.env.EXPO_PUBLIC_API_URL;

export const hasApi = !!BASE;

const HAZARD_TYPES: HazardType[] = [
  'blocked_sidewalk',
  'fallen_tree',
  'construction',
  'other',
];

function toHazard(row: any): Hazard | null {
  if (!row) return null;
  const lat = row.lat ?? row.latitude ?? row.coords?.latitude;
  const lng = row.lng ?? row.lon ?? row.longitude ?? row.coords?.longitude;
  const type = HAZARD_TYPES.includes(row.type) ? (row.type as HazardType) : 'other';
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    id: String(row.id ?? `api-${JSON.stringify(row)}`),
    type,
    coords: { latitude: lat, longitude: lng },
    note: row.note ?? null,
    photoUri: row.photoUri ?? null,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
    savedLocally: false,
  };
}

// GET /hazards — returns [] when the backend is unreachable, so screens can
// carry on with locally saved reports. Teammates: shape is "whatever the
// backend sends"; unknown fields are ignored, missing IDs get one.
export async function fetchHazards(): Promise<Hazard[]> {
  if (!BASE) return [];
  try {
    const res = await fetch(`${BASE}/hazards`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return (Array.isArray(rows) ? rows : (rows.features ?? []))
      .map(toHazard)
      .filter((h: Hazard | null): h is Hazard => h !== null);
  } catch {
    return [];
  }
}

// POST /hazards — scene: a teammate points this at the real API. Falls back to
// the returned row when the backend answers, otherwise to a local record.
export async function postHazard(input: NewHazard): Promise<Hazard | null> {
  if (!BASE) return null;
  try {
    const res = await fetch(`${BASE}/hazards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return toHazard(await res.json());
  } catch {
    return null;
  }
}
