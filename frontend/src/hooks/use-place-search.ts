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

/** Debounced PlaceKit autocomplete. Pass `enabled=false` to pause searching. */
export function usePlaceSearch(query: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!enabled || query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch("https://api.placekit.co/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-placekit-api-key": process.env.EXPO_PUBLIC_PLACEKIT_KEY!,
          },
          body: JSON.stringify({
            query,
            countries: ["us"],
            coordinates: `${DC_REGION.latitude},${DC_REGION.longitude}`,
            maxResults: 5,
          }),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`PlaceKit error: ${response.status}`);

        const data: { results: PlaceSuggestion[] } = await response.json();
        if (!controller.signal.aborted) setSuggestions(data.results);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("PlaceKit autocomplete:", error);
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

  return { suggestions, searching, clearSuggestions: () => setSuggestions([]) };
}
