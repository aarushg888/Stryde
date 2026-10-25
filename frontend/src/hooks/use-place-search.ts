import { DC_REGION } from "@/utils/geo";
import { useEffect, useState } from "react";

export type PlaceSuggestion = {
  name: string;
  city?: string;
  administrative?: string;
  lat: number;
  lng: number;
};

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

/**
 * Debounced place autocomplete with two providers:
 *  1. PlaceKit (commercial) — used when EXPO_PUBLIC_PLACEKIT_KEY is set;
 *  2. Nominatim/OSM (keyless, CORS-enabled) as the default fallback so the
 *     destination search always works in demos without an account.
 * Both are biased toward the Beltway area around the demo coverage region.
 */
export function usePlaceSearch(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!enabled || query.trim().length < MIN_QUERY_LENGTH) {
      return;
    }

    const controller = new AbortController();

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchPlaces(query.trim(), controller.signal);
        if (!controller.signal.aborted) setSuggestions(results);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Place autocomplete failed:", error);
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, enabled]);

  // Consumers see an empty list whenever the query is too short to search;
  // results are only ever appended by the fetch effect itself.
  const visibleSuggestions =
    enabled && query.trim().length >= MIN_QUERY_LENGTH ? suggestions : [];

  return { suggestions: visibleSuggestions, searching, clearSuggestions: () => setSuggestions([]) };
}

async function searchPlaces(
  query: string,
  signal: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const key = process.env.EXPO_PUBLIC_PLACEKIT_KEY;
  if (key) {
    const response = await fetch("https://api.placekit.co/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-placekit-api-key": key,
      },
      body: JSON.stringify({
        query,
        countries: ["us"],
        coordinates: `${DC_REGION.latitude},${DC_REGION.longitude}`,
        maxResults: 5,
      }),
      signal,
    });
    if (!response.ok) throw new Error(`PlaceKit error: ${response.status}`);
    const data: { results: PlaceSuggestion[] } = await response.json();
    return data.results;
  }
  return nominatimSearch(query, signal);
}

// A generous DC/Beltway viewbox (left,top,right,bottom) to bias results.
const VIEWBOX = "-77.20,39.05,-76.80,38.70";

type NominatimRow = {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
};

async function nominatimSearch(
  query: string,
  signal: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "5",
    addressdetails: "1",
    "accept-language": "en",
    viewbox: VIEWBOX,
  });
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`Nominatim error: ${response.status}`);
  const rows: NominatimRow[] = await response.json();
  return rows.map((row) => {
    const address = row.address ?? {};
    const parts = row.display_name.split(",").map((part) => part.trim());
    return {
      name: address.road
        ? `${address.road}${address.house_number ? " " + address.house_number : ""}`
        : parts[0],
      city:
        address.city ??
        address.town ??
        address.village ??
        address.neighbourhood ??
        address.suburb,
      administrative: address.state ?? address.state_district,
      lat: Number.parseFloat(row.lat),
      lng: Number.parseFloat(row.lon),
    };
  });
}
