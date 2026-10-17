import type { LatLng } from './routing';

import { postHazard } from './api';

export type HazardType = 'blocked_sidewalk' | 'fallen_tree' | 'construction' | 'other';

export const HAZARD_TYPES: { id: HazardType; label: string }[] = [
  { id: 'blocked_sidewalk', label: 'Blocked sidewalk' },
  { id: 'fallen_tree', label: 'Fallen tree' },
  { id: 'construction', label: 'Construction' },
  { id: 'other', label: 'Other' },
];

export function hazardLabel(type: HazardType): string {
  return HAZARD_TYPES.find((t) => t.id === type)?.label ?? 'Hazard';
}

export type Hazard = {
  id: string;
  type: HazardType;
  coords: LatLng;
  note?: string | null;
  // Photos need expo-image-picker and a native rebuild. Left empty on purpose.
  photoUri?: string | null;
  createdAt: number;
  // True means this report exists only on this device so far.
  savedLocally: boolean;
};

export type NewHazard = Omit<Hazard, 'id' | 'createdAt' | 'savedLocally'>;

// Reports go to the backend when EXPO_PUBLIC_API_URL is set and reachable,
// otherwise they are kept on this device behind the same function, so a
// teammate can point it at the real API later without touching any screens.
export async function submitHazard(input: NewHazard): Promise<Hazard> {
  const remote = await postHazard(input);
  if (remote) return remote;
  return {
    ...input,
    id: `local-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    createdAt: Date.now(),
    savedLocally: true,
  };
}
