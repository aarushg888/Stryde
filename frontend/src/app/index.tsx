import { api, RouteResult } from "@/api/api";
import { AppMap } from "@/components/app-map";
import type { AppMapHandle } from "@/components/app-map-types";
import { ThemedView } from "@/components/themed-view";
import { usePlaceSearch } from "@/hooks/use-place-search";
import { Spacing } from "@/constants/theme";
import { DC_REGION, parseLatLng } from "@/utils/geo";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ROUTE_META = [
  { title: "Safest", subtitle: "fewest barriers", color: "#22c55e" },
  { title: "Balanced", subtitle: "some risk", color: "#eab308" },
  { title: "Shortest", subtitle: "highest risk", color: "#ef4444" },
] as const;
const WALK_SPEED_KMH = 4.5;

export default function HomeScreen() {
  const [startLocation, setStartLocation] = useState("");
  const [destination, setDestination] = useState("");
  const [startLocationCoords, setStartLocationCoords] = useState("");
  const [destinationCoords, setDestinationCoords] = useState("");
  const [routes, setRoutes] = useState<RouteResult | null>(null);
  const [curr, setCurr] = useState(0);
  const [routeCoords, setRouteCoords] =
    useState<{ latitude: number; longitude: number }[][]>();
  const [routeError, setRouteError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [mapPickMode, setMapPickMode] = useState<"start" | "destination" | null>(
    null,
  );
  const [activeField, setActiveField] = useState<"start" | "destination" | null>(
    null,
  );
  const [gpsBusy, setGpsBusy] = useState(false);
  const mapRef = React.useRef<AppMapHandle>(null);

  const startCoordinate = parseLatLng(startLocationCoords);
  const destinationCoordinate = parseLatLng(destinationCoords);
  const startSet = Boolean(startCoordinate);
  const destSet = Boolean(destinationCoordinate);

  // Debounced place search shown under the currently focused field.
  const activeQuery =
    activeField === "destination"
      ? destination
      : activeField === "start"
        ? startLocation
        : "";
  const { suggestions, searching, clearSuggestions } = usePlaceSearch(
    activeQuery,
    activeField !== null,
  );

  // Collapse the dropdown when the hardware keyboard/blur happens elsewhere.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () =>
      setActiveField(null),
    );
    return sub.remove;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
  }, []);

  const clearRoute = () => {
    setRoutes(null);
    setRouteCoords(undefined);
    setCurr(0);
    setRouteError(null);
  };

  const swapEnds = () => {
    const startText = startLocation;
    const startCoords = startLocationCoords;
    setStartLocation(destination);
    setStartLocationCoords(destinationCoords);
    setDestination(startText);
    setDestinationCoords(startCoords);
    clearRoute();
  };

  const selectSuggestion = (field: "start" | "destination", index: number) => {
    const item = suggestions[index];
    if (!item) return;
    Keyboard.dismiss();
    setActiveField(null);
    clearSuggestions();
    const coords = `${item.lat.toFixed(6)},${item.lng.toFixed(6)}`;
    const label = item.name;
    if (field === "start") {
      setStartLocation(label);
      setStartLocationCoords(coords);

    } else {
      setDestination(label);
      setDestinationCoords(coords);

    }
    clearRoute();
  };

  const useMyLocation = async () => {
    try {
      setGpsBusy(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setRouteError("Location permission is needed to use GPS.");
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = location.coords;
      setStartLocation("My location");
      setStartLocationCoords(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
      setActiveField(null);
      clearSuggestions();
      clearRoute();
    } finally {
      setGpsBusy(false);
    }
  };

  const handleFindRoute = async () => {
    Keyboard.dismiss();
    setActiveField(null);
    if (!startLocationCoords || !destinationCoords) {
      setRouteError("Choose a start and a destination first.");
      return;
    }
    setFinding(true);
    clearRoute();
    try {
      const result = await api.searchRoute(
        startLocationCoords,
        destinationCoords,
      );
      const coordArr = result.paths.map((p) =>
        p.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
      );
      setRoutes(result);
      setRouteCoords(coordArr);
      setCurr(0);
      mapRef.current?.fitToCoordinates(coordArr[0], {
        edgePadding:
          Platform.OS === "web"
            ? { top: 190, right: 40, bottom: 230, left: 40 }
            : { top: 170, right: 40, bottom: 220, left: 40 },
        animated: true,
      });
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : "Routing failed");
    } finally {
      setFinding(false);
    }
  };

  const selectRouteChip = (i: number) => {
    setCurr(i);
    if (routeCoords?.[i]) {
      mapRef.current?.fitToCoordinates(routeCoords[i], {
        edgePadding: { top: 170, right: 40, bottom: 230, left: 40 },
        animated: true,
      });
    }
  };

  const clearAll = () => {
    clearRoute();
    setStartLocation("");
    setStartLocationCoords("");
    setDestination("");
    setDestinationCoords("");
    setMapPickMode(null);
    setActiveField(null);
    clearSuggestions();
  };

  const inputRows = (["start", "destination"] as const).map((field) => {
    const isStart = field === "start";
    const label = isStart ? startLocation : destination;
    const hasCoords = isStart
      ? Boolean(startCoordinate)
      : Boolean(destinationCoordinate);
    const focused = activeField === field;
    return { field, isStart, label, hasCoords, focused };
  });

  return (
    <ThemedView style={styles.container}>
      <View style={styles.mapWrap}>
        <AppMap
          ref={mapRef}
          style={styles.map}
          initialRegion={DC_REGION}          onPressPick={(latitude, longitude) => {
            if (!mapPickMode) return;
            const coords = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
            if (mapPickMode === "start") {
              setStartLocation("Pinned location");
              setStartLocationCoords(coords);
            } else {
              setDestination("Pinned location");
              setDestinationCoords(coords);
            }
            setMapPickMode(null);
            setActiveField(null);
            clearSuggestions();
            clearRoute();
          }}
          routes={
            routeCoords
              ? routeCoords.map((coordinates, i) => ({
                  coordinates,
                  color: ROUTE_META[Math.min(i, ROUTE_META.length - 1)].color,
                  selected: i === curr,
                }))
              : undefined
          }
          markers={[
            ...(startCoordinate
              ? [{ coordinate: startCoordinate, color: "#22c55e", title: "Start" }]
              : []),
            ...(destinationCoordinate
              ? [
                  {
                    coordinate: destinationCoordinate,
                    color: "#ef4444",
                    title: "Destination",
                  },
                ]
              : []),
          ]}
        />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.foreground}
        pointerEvents="box-none"
      >
        <SafeAreaView
          style={styles.safeArea}
          edges={["top", "left", "right"]}
          pointerEvents="box-none"
        >
          {/* Planner card */}
          <View style={[styles.planner, styles.shadow]}>
            {inputRows.map(({ field, isStart, label, hasCoords, focused }) => (
              <View key={field}>
                <View
                  style={[
                    styles.inputRow,
                    focused && { borderColor: "#22c55e" },
                  ]}
                >
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: isStart ? "#22c55e" : "#ef4444" },
                    ]}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={
                      isStart
                        ? "Start — enter address or pin on map"
                        : "Destination — enter address or pin on map"
                    }
                    placeholderTextColor="#5b6b7b"
                    value={label}
                    onChangeText={(text) => {
                      if (isStart) setStartLocation(text);
                      else setDestination(text);
                      clearRoute();
                    }}
                    onFocus={() => setActiveField(field)}
                    onBlur={() => {
                      // Small delay so suggestion taps win the race.
                      setTimeout(() => {
                        setActiveField((f) => (f === field ? null : f));
                      }, 180);
                    }}
                    onSubmitEditing={() => selectSuggestion(field, 0)}
                    returnKeyType="search"
                  />
                  {isStart ? (
                    <TouchableOpacity
                      onPress={useMyLocation}
                      hitSlop={8}
                      style={styles.iconBtn}
                    >
                      {gpsBusy ? (
                        <ActivityIndicator color="#22c55e" size="small" />
                      ) : (
                        <MaterialIcons
                          name="my-location"
                          size={17}
                          color="#22c55e"
                        />
                      )}
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    onPress={() => {
                      setMapPickMode(field);
                      setActiveField(null);
                      clearSuggestions();
                    }}
                    hitSlop={8}
                    style={styles.iconBtn}
                  >
                    <MaterialIcons name="map" size={17} color="#93c5fd" />
                  </TouchableOpacity>
                  {!isStart ? (
                    <TouchableOpacity
                      onPress={swapEnds}
                      hitSlop={8}
                      style={styles.iconBtn}
                    >
                      <MaterialIcons name="swap-vert" size={17} color="#94a3b8" />
                    </TouchableOpacity>
                  ) : null}
                  {hasCoords ? (
                    <View style={styles.checkDot} />
                  ) : null}
                </View>
              </View>
            ))}

            {/* Suggestions for the focused field */}
            {activeField && (searching || suggestions.length > 0) ? (
              <View style={[styles.suggestions, styles.shadow]}>
                {searching ? (
                  <View style={styles.suggestionRow}>
                    <ActivityIndicator color="#22c55e" size="small" />
                    <Text style={styles.suggestionSub}>Searching…</Text>
                  </View>
                ) : null}
                {suggestions.map((s, i) => (
                  <Pressable
                    key={`${s.lat},${s.lng},${i}`}
                    style={styles.suggestionRow}
                    onPress={() => selectSuggestion(activeField!, i)}
                  >
                    <MaterialIcons
                      name="location-on"
                      size={16}
                      color={activeField === "start" ? "#22c55e" : "#ef4444"}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionTitle}>{s.name}</Text>
                      {!!(s.city || s.administrative) && (
                        <Text style={styles.suggestionSub} numberOfLines={1}>
                          {[s.city, s.administrative].filter(Boolean).join(", ")}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>

          {mapPickMode ? (
            <View style={[styles.pickBanner, styles.shadow]}>
              <MaterialIcons name="touch-app" size={15} color="#93c5fd" />
              <Text style={styles.pickText}>
                Tap the map to set{" "}
                {mapPickMode === "start" ? "start" : "destination"}
              </Text>
              <TouchableOpacity onPress={() => setMapPickMode(null)} hitSlop={8}>
                <MaterialIcons name="close" size={16} color="#94a3b8" />
              </TouchableOpacity>
            </View>
          ) : null}

          {routeError && !finding ? (
            <View style={[styles.errorCard, styles.shadow]}>
              <MaterialIcons name="error-outline" size={15} color="#f87171" />
              <Text style={styles.errorText} numberOfLines={2}>
                {routeError}
              </Text>
            </View>
          ) : null}

          {!routes ? (
            <View style={styles.ctaWrap} pointerEvents="box-none">
              <TouchableOpacity
                style={[
                  styles.cta,
                  styles.shadow,
                  (finding || !startSet || !destSet) && { opacity: 0.55 },
                ]}
                onPress={handleFindRoute}
                disabled={finding || !startSet || !destSet}
                activeOpacity={0.8}
              >
                {finding ? (
                  <ActivityIndicator color="#0c1210" size="small" />
                ) : (
                  <MaterialIcons name="directions-walk" size={19} color="#0c1210" />
                )}
                <Text style={styles.ctaText}>
                  {finding ? "Finding routes…" : "Find Routes"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.resultCard, styles.shadow]}>
              <View style={styles.resultHead}>
                <Text style={styles.resultTitle}>Your routes</Text>
                <TouchableOpacity onPress={clearAll} hitSlop={8}>
                  <MaterialIcons name="close" size={17} color="#94a3b8" />
                </TouchableOpacity>
              </View>
              <View style={styles.chipRow}>
                {routes.paths.map((p, i) => {
                  const meta = ROUTE_META[Math.min(i, ROUTE_META.length - 1)];
                  const km = (p.total_cut_m / 1000).toFixed(2);
                  const mins = Math.max(
                    1,
                    Math.round((p.total_cut_m / 1000 / WALK_SPEED_KMH) * 60),
                  );
                  const selected = i === curr;
                  return (
                    <Pressable
                      key={`chip-${i}`}
                      onPress={() => selectRouteChip(i)}
                      style={[
                        styles.chip,
                        selected && {
                          borderColor: meta.color,
                          backgroundColor: `${meta.color}26`,
                        },
                      ]}
                    >
                      <View
                        style={[styles.chipDot, { backgroundColor: meta.color }]}
                      />
                      <View style={styles.chipBody}>
                        <Text style={styles.chipTitle}>{meta.title}</Text>
                        <Text style={styles.chipMeta}>
                          {mins} min · {km} km · {meta.subtitle}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f14" },
  mapWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  map: { flex: 1 },
  foreground: { flex: 1, position: "relative" },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === "web" ? 70 : 0,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  shadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 14,
  },
  planner: {
    backgroundColor: "rgba(15,20,26,0.94)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: Spacing.two + 2,
    gap: Spacing.two,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    paddingHorizontal: 10,
    height: 46,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  input: { flex: 1, color: "#e2e8f0", fontSize: 15, paddingVertical: 0 },
  iconBtn: { paddingHorizontal: 4 },
  checkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
    marginRight: 2,
  },
  suggestions: {
    backgroundColor: "rgba(13,17,22,0.98)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    maxHeight: 220,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  suggestionTitle: { color: "#e2e8f0", fontSize: 14, fontWeight: "600" },
  suggestionSub: { color: "#64748b", fontSize: 11.5, marginTop: 1 },
  pickBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    backgroundColor: "rgba(13,18,24,0.94)",
    borderWidth: 1,
    borderColor: "rgba(147,197,253,0.4)",
  },
  pickText: { color: "#dbeafe", fontSize: 12.5, fontWeight: "600" },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 14,
    backgroundColor: "rgba(127,29,29,0.3)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.35)",
  },
  errorText: { color: "#fca5a5", fontSize: 12, flex: 1 },
  ctaWrap: { flex: 1, justifyContent: "flex-end", paddingBottom: Spacing.four },
  cta: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.five,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#22c55e",
  },
  ctaText: { color: "#0c1210", fontSize: 15.5, fontWeight: "800" },
  resultCard: {
    backgroundColor: "rgba(15,20,26,0.96)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: Spacing.two,
    marginBottom: Spacing.two,
  },
  resultHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    paddingBottom: Spacing.one,
  },
  resultTitle: { color: "#f1f5f9", fontSize: 13, fontWeight: "800" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
  },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  chipBody: { maxWidth: 118 },
  chipTitle: { color: "#f1f5f9", fontSize: 12.5, fontWeight: "700" },
  chipMeta: { color: "#94a3b8", fontSize: 10.5 },
});
