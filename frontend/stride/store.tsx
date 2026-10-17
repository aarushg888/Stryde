import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { fetchHazards, hasApi } from './api';
import { submitHazard, type Hazard, type NewHazard } from './hazards';
import type { ProfileId } from './profiles';
import type { Place, Route } from './routing';

export type RouteId = 'standard' | 'accessible';

export type Preferences = {
  profileId: ProfileId;
  // Route shape preferences. Some of these map onto OpenRouteService options;
  // ones marked "needs data" are held but not used yet.
  preferSidewalks: boolean; // needs sidewalk data - placeholder
  preferProtectedCrossings: boolean; // needs crossing data - placeholder
  wellLit: boolean; // needs lighting data - placeholder
  lowTraffic: boolean;
  // Accessibility limits (used by the wheelchair profile).
  maxInclinePct: number;
  maxKerbM: number;
  pavedOnly: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  profileId: 'walking',
  preferSidewalks: true,
  preferProtectedCrossings: true,
  wellLit: false,
  lowTraffic: false,
  maxInclinePct: 6,
  maxKerbM: 0.06,
  pavedOnly: false,
};

type Store = {
  origin: Place | null;
  destination: Place | null;
  routes: Route[];
  selectedRouteId: RouteId | null;
  hazards: Hazard[];
  preferences: Preferences;
  setOrigin: (p: Place | null) => void;
  setDestination: (p: Place | null) => void;
  setRoutes: (r: Route[]) => void;
  setSelectedRouteId: (id: RouteId | null) => void;
  reportHazard: (input: NewHazard) => Promise<Hazard>;
  updatePreferences: (p: Partial<Preferences>) => void;
  // Pulls reported hazards from the backend when EXPO_PUBLIC_API_URL is set;
  // merges them with anything reported on this device (deduped by id).
  loadHazards: () => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<RouteId | null>(null);
  const [hazards, setHazards] = useState<Hazard[]>([]);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);

  const reportHazard = useCallback(async (input: NewHazard) => {
    const hazard = await submitHazard(input);
    setHazards((prev) => [...prev, hazard]);
    return hazard;
  }, []);

  const updatePreferences = useCallback((p: Partial<Preferences>) => {
    setPreferences((prev) => ({ ...prev, ...p }));
  }, []);

  const loadHazards = useCallback(async () => {
    if (!hasApi) return;
    const remote = await fetchHazards();
    if (remote.length === 0) return;
    setHazards((prev) => {
      const seen = new Set(prev.map((h) => h.id));
      return [...prev, ...remote.filter((h) => !seen.has(h.id))];
    });
  }, []);

  const value = useMemo<Store>(
    () => ({
      origin,
      destination,
      routes,
      selectedRouteId,
      hazards,
      preferences,
      setOrigin,
      setDestination,
      setRoutes,
      setSelectedRouteId,
      reportHazard,
      updatePreferences,
      loadHazards,
    }),
    [origin, destination, routes, selectedRouteId, hazards, preferences, reportHazard, updatePreferences, loadHazards],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
