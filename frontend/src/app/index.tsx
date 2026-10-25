import { api, RouteResult, type HazardReport } from "@/api/api";
import { AppMap } from "@/components/app-map";
import type { AppMapHandle } from "@/components/app-map-types";
import { HazardsPanel } from "@/components/hazards-panel";
import { PreferencesPanel } from "@/components/preferences-panel";
import { RouteSidebar } from "@/components/route-sidebar";
import { ThemedView } from "@/components/themed-view";
import { usePlaceSearch } from "@/hooks/use-place-search";
import { Spacing } from "@/constants/theme";
import { DC_REGION, inDC, parseLatLng } from "@/utils/geo";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ROUTE_META = [
  { title: "Safest", subtitle: "fewest barriers", color: "#22c55e" },
  { title: "Balanced", subtitle: "some risk", color: "#eab308" },
  { title: "Shortest", subtitle: "highest risk", color: "#ef4444" },
] as const;
const WALK_SPEED_KMH = 4.5;
const HAZARD_EMOJI: Record<string, string> = {
  Sidewalk: "♿",
  Tree: "🌳",
  Construction: "🚧",
  Other: "❗",
};

type DrawerTab = "route" | "hazards" | "prefs";

const TAB_META: { id: DrawerTab; label: string; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { id: "route", label: "Route", icon: "tune" },
  { id: "hazards", label: "Hazards", icon: "report-problem" },
  { id: "prefs", label: "Preferences", icon: "person" },
];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 1024;

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
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("route");
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

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidHide", () =>
      setActiveField(null),
    );
    return sub.remove;
  }, []);

  // Community hazard layer for the map badges (refreshed after each submit).
  const loadHazards = () => {
    api
      .listHazards(30)
      .then((res) => setHazards(res.hazards))
      .catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    api
      .listHazards(30)
      .then((res) => {
        if (alive) setHazards(res.hazards);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
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
    if (!inDC(item.lat, item.lng)) {
      setRouteError("Stryde currently covers Washington, DC only.");
      return;
    }
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
      if (!inDC(latitude, longitude)) {
        setRouteError("Stryde currently covers Washington, DC only.");
        return;
      }
      setStartLocation("My location");
      setStartLocationCoords(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
      setActiveField(null);
      clearSuggestions();
      clearRoute();
    } finally {
      setGpsBusy(false);
    }
  };

  const runSearch = async () => {
    if (!startLocationCoords || !destinationCoords) {
      setRouteError("Choose a start and a destination first.");
      return;
    }
    setFinding(true);
    setRouteError(null);
    try {
      let saved: Record<string, unknown> = {};
      try {
        saved = await api.getPreferences();
      } catch {
        // defaults are fine when the backend has no profile yet
      }
      const result = await api.searchRoute(
        startLocationCoords,
        destinationCoords,
        {
          mode: typeof saved.routingMode === "string" ? (saved.routingMode as string) : undefined,
          preferSidewalks: saved.preferSidewalks === true,
          avoidObstacles: saved.avoidObstacles === true,
          wellLitOnly: saved.wellLitOnly === true,
          lowTraffic: saved.lowTraffic === true,
        },
      );
      const coordArr = result.paths.map((p) =>
        p.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
      );
      setRoutes(result);
      setRouteCoords(coordArr);
      setCurr(0);
      setLastUpdated(new Date().valueOf());
      mapRef.current?.fitToCoordinates(coordArr[0], {
        edgePadding: fitPadding(),
        animated: true,
      });
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : "Routing failed");
    } finally {
      setFinding(false);
    }
  };

  const fitPadding = () => {
    const pad = { top: 90, right: 40, bottom: 210, left: 40 };
    if (Platform.OS === "web" && wide && drawerOpen && sheetOpen === false) {
      pad.right = 380;
    }
    return { ...pad } as const;
  };

  const selectRouteChip = (i: number) => {
    setCurr(i);
    if (routeCoords?.[i]) {
      mapRef.current?.fitToCoordinates(routeCoords[i], {
        edgePadding: fitPadding(),
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
    const scopedCoords = isStart ? startLocationCoords : destinationCoords;
    const hasCoords = Boolean(parseLatLng(scopedCoords));
    return { field, isStart, label, hasCoords, focused: activeField === field };
  });

  const hazardMarkers = hazards
    .filter((h) => h.lat !== 0 || h.lng !== 0)
    .slice(0, 60)
    .map((h, i) => ({
      coordinate: { latitude: h.lat, longitude: h.lng },
      color: "rgba(240,190,60,0.95)",
      title: h.type,
      description: h.description,
      variant: "note" as const,
      emoji: HAZARD_EMOJI[h.type] ?? "❗",
      key: `hazard-${h.id}-${i}`,
    }));

  const mapElement = (
    <View style={styles.mapWrap}>
      <AppMap
        ref={mapRef}
        style={styles.map}
        initialRegion={DC_REGION}
        onPressPick={(latitude, longitude) => {
          if (!mapPickMode) return;
          if (!inDC(latitude, longitude)) {
            setRouteError("Stryde currently covers Washington, DC only.");
            setMapPickMode(null);
            return;
          }
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
            ? [{ coordinate: startCoordinate, color: "#22c55e", title: "Start", variant: "pin" as const }]
            : []),
          ...(destinationCoordinate
            ? [
                {
                  coordinate: destinationCoordinate,
                  color: "#ef4444",
                  title: "Destination",
                  variant: "pin" as const,
                },
              ]
            : []),
          ...hazardMarkers,
        ]}
      />
    </View>
  );

  // ---- Shared pieces -------------------------------------------------------

  const renderPlanner = () => (
    <View style={[styles.planner, styles.frost]}>
      {inputRows.map(({ field, isStart, label, focused }) => (
        <View key={field}>
          <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
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
                  ? "Start — address, GPS or map pin"
                  : "Destination — address or map pin"
              }
              placeholderTextColor="#5f7183"
              value={label}
              onChangeText={(text) => {
                if (isStart) setStartLocation(text);
                else setDestination(text);
                clearRoute();
              }}
              onFocus={() => setActiveField(field)}
              onBlur={() =>
                setTimeout(() => {
                  setActiveField((f) => (f === field ? null : f));
                }, 180)
              }
              onSubmitEditing={() => selectSuggestion(field, 0)}
              returnKeyType="search"
            />
            {isStart ? (
              <TouchableOpacity onPress={useMyLocation} hitSlop={8}>
                {gpsBusy ? (
                  <ActivityIndicator color="#22c55e" size="small" />
                ) : (
                  <MaterialIcons name="my-location" size={17} color="#22c55e" />
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
            >
              <MaterialIcons name="map" size={17} color="#93c5fd" />
            </TouchableOpacity>
            {!isStart ? (
              <TouchableOpacity onPress={swapEnds} hitSlop={8}>
                <MaterialIcons name="swap-vert" size={17} color="#94a3b8" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ))}

      {activeField && (searching || suggestions.length > 0) ? (
        <View style={styles.suggestions}>
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
  );

  const renderErrorCard = () =>
    routeError && !finding ? (
      <View style={[styles.errorCard, styles.frost]}>
        <MaterialIcons name="error-outline" size={15} color="#f87171" />
        <Text style={styles.errorText} numberOfLines={2}>
          {routeError}
        </Text>
      </View>
    ) : null;

  const renderPickBanner = () =>
    mapPickMode ? (
      <View style={[styles.pickBanner, styles.frost]}>
        <MaterialIcons name="touch-app" size={15} color="#93c5fd" />
        <Text style={styles.pickText}>
          Tap the map to set {mapPickMode === "start" ? "start" : "destination"}
        </Text>
        <TouchableOpacity onPress={() => setMapPickMode(null)} hitSlop={8}>
          <MaterialIcons name="close" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>
    ) : null;

const renderCta = () =>
  routes && routeCoords ? null : (
    <TouchableOpacity
      style={[
        styles.cta,
        styles.frost,
        styles.ctaSolid,
        (finding || !startSet || !destSet) && { opacity: 0.55 },
      ]}
      onPress={runSearch}
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
  );

const renderRoutesCard = () =>
  routes && routeCoords ? (
    <View
      style={[styles.resultDock, wide && styles.resultDockWide]}
      pointerEvents="box-none"
    >
      <View style={[styles.resultCard, styles.frost]}>
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
                <View style={[styles.chipDot, { backgroundColor: meta.color }]} />
                <View style={styles.chipBody}>
                  <Text style={styles.chipTitle}>{meta.title}</Text>
                  <Text style={styles.chipMeta}>
                    {mins} min · {km} km
                  </Text>
                  <Text style={styles.chipMetaDim}>{meta.subtitle}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  ) : null;
  /** Drawer contents — subtab header + the active subtab's panel. */
  const renderDrawerBody = () => (
    <>
      <View style={styles.drawerTabsRow}>
        <View style={styles.drawerTabs}>
          {TAB_META.map((tab) => {
            const selected = drawerTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.drawerTab, selected && styles.drawerTabOn]}
                onPress={() => setDrawerTab(tab.id)}
                activeOpacity={0.75}
              >
                <MaterialIcons
                  name={tab.icon}
                  size={15}
                  color={selected ? "#22c55e" : "#7c8ea1"}
                />
                <Text
                  style={[styles.drawerTabText, selected && styles.drawerTabTextOn]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          onPress={() => {
            setDrawerOpen(false);
            setSheetOpen(false);
          }}
          hitSlop={8}
          style={styles.drawerClose}
        >
          <MaterialIcons
            name={wide ? "chevron-right" : "expand-more"}
            size={20}
            color="#94a3b8"
          />
        </TouchableOpacity>
      </View>

      <View style={styles.drawerBody}>
        {drawerTab === "route" ? (
          <RouteSidebar
            onUpdateRoute={runSearch}
            canUpdate={startSet && destSet}
            updating={finding}
            lastUpdated={lastUpdated}
          />
        ) : null}
        {drawerTab === "hazards" ? (
          <HazardsPanel onSubmitted={loadHazards} />
        ) : null}
        {drawerTab === "prefs" ? (
          <PreferencesPanel onPrefsChanged={loadHazards} />
        ) : null}
      </View>
    </>
  );

  // ---- Layout: ONE full-bleed map with floating overlay cards --------------

  return (
    <ThemedView style={styles.container}>
      {mapElement}
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
          {/* Floating planner column (over the map) */}
          <View style={[styles.leftStack, wide && styles.leftStackWide]} pointerEvents="box-none">
            {wide ? (
              <View style={styles.brandRow}>
                <Text style={styles.brand}>Stryde</Text>
                <Text style={styles.brandTag}>safe walks in DC</Text>
              </View>
            ) : null}
            {renderPlanner()}
            {renderErrorCard()}
            {renderCta()}
            {renderPickBanner()}
          </View>
          {renderRoutesCard()}

          {/* Docked drawer (wide desktop layout) */}
          {wide && drawerOpen ? (
            <ThemedView style={[styles.drawerWide, styles.frost]}>
              {renderDrawerBody()}
            </ThemedView>
          ) : null}

          {/* Drawer reopen tab (wide desktop layout) */}
          {wide && !drawerOpen ? (
            <TouchableOpacity
              style={[styles.drawerReopen, styles.frost]}
              onPress={() => setDrawerOpen(true)}
              activeOpacity={0.85}
            >
              <MaterialIcons name="tune" size={18} color="#22c55e" />
              <Text style={styles.drawerReopenText}>Route tools</Text>
            </TouchableOpacity>
          ) : null}

          {/* FAB trigger for the bottom sheet (mobile/narrow) */}
          {!wide && !sheetOpen && !routes && !mapPickMode ? (
            <TouchableOpacity
              style={[styles.fab, styles.frostRow]}
              onPress={() => setSheetOpen(true)}
              activeOpacity={0.85}
            >
              <MaterialIcons name="tune" size={18} color="#0c1210" />
              <Text style={styles.fabText}>Route tools</Text>
            </TouchableOpacity>
          ) : null}
        </SafeAreaView>
      </KeyboardAvoidingView>

      {/* Bottom sheet drawer (mobile/narrow) */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setSheetOpen(false)} />
          <ThemedView style={[styles.sheet, styles.frost]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetBody}>{renderDrawerBody()}</View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0f14" },
  mapWrap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  map: { flex: 1 },
  foreground: { flex: 1, position: "relative" },
  safeArea: { flex: 1 },
  frost: {
    backgroundColor: "rgba(13,18,24,0.86)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 16,
  },
  leftStack: {
    position: "absolute",
    top: Spacing.three,
    left: Spacing.three,
    right: Spacing.three,
    gap: Spacing.two,
    alignSelf: "flex-start",
  },
  leftStackWide: {
    left: Spacing.four,
    right: 396,
    top: Spacing.four,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: 4,
  },
  brand: { color: "#f1f5f9", fontSize: 22, fontWeight: "800", letterSpacing: 0.4 },
  brandTag: { color: "#64748b", fontSize: 12, fontWeight: "600" },
  planner: {
    padding: Spacing.three - 2,
    gap: Spacing.two + 2,
    maxWidth: wideSafe(520),
    minWidth: 300,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 15,
    borderWidth: 1.4,
    borderColor: "rgba(255,255,255,0.1)",
    paddingHorizontal: 13,
    height: 50,
  },
  inputRowFocused: {
    borderColor: "#22c55e",
    backgroundColor: "rgba(255,255,255,0.09)",
  },
  dot: { width: 12, height: 12, borderRadius: 6, marginLeft: 2 },
  input: { flex: 1, color: "#e2e8f0", fontSize: 15.5, paddingVertical: 0 },
  suggestions: {
    backgroundColor: "rgba(13,17,22,0.98)",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
    maxHeight: 230,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  suggestionTitle: { color: "#e2e8f0", fontSize: 14.5, fontWeight: "600" },
  suggestionSub: { color: "#64748b", fontSize: 11.5, marginTop: 1, marginLeft: 12 },
  pickBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  pickText: { color: "#dbeafe", fontSize: 12.5, fontWeight: "600" },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 13,
  },
  errorText: { color: "#fca5a5", fontSize: 12, flex: 1 },
  ctaSolid: { backgroundColor: "#22c55e", borderRadius: 999, borderWidth: 0 },
  cta: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: Spacing.five,
    paddingVertical: 15,
  },
  ctaText: { color: "#0c1210", fontSize: 15.5, fontWeight: "800" },
resultDock: {
  position: "absolute",
  left: Spacing.three,
  right: Spacing.three,
  bottom: Spacing.four + 2,
},
resultDockWide: {
  left: Spacing.four,
  right: 396,          // matches leftStackWide, clears the 356px drawer
  maxWidth: 520,
},
  resultCard: {
    padding: Spacing.three - 2,
  },
  resultHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    paddingBottom: Spacing.two,
  },
  resultTitle: { color: "#f1f5f9", fontSize: 14, fontWeight: "800" },
  chipRow: { flexDirection: "row", gap: Spacing.two },
  chip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: Spacing.two + 2,
    gap: 4,
  },
  chipDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 2 },
  chipBody: { flex: 1 },
  chipTitle: { color: "#f1f5f9", fontSize: 13, fontWeight: "800" },
  chipMeta: { color: "#cbd5e1", fontSize: 11.5, fontWeight: "600" },
  chipMetaDim: { color: "#64748b", fontSize: 10.5 },
  // Right drawer (docked on desktop)
  drawerWide: {
    position: "absolute",
    top: Spacing.three,
    bottom: Spacing.three,
    right: Spacing.three,
    width: 356,
  },
  drawerReopen: {
    position: "absolute",
    right: Spacing.three,
    top: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 999,
  },
  drawerReopenText: { color: "#e2e8f0", fontSize: 13.5, fontWeight: "700" },
  drawerTabsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.two + 6,
    paddingTop: Spacing.two + 6,
    gap: 6,
  },
  drawerTabs: { flex: 1, flexDirection: "row", gap: 6 },
  drawerTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
    minWidth: 0,
  },
  drawerTabOn: {
    borderColor: "rgba(34,197,94,0.55)",
    backgroundColor: "rgba(34,197,94,0.14)",
  },
  drawerTabText: { color: "#9fb2c5", fontSize: 11.5, fontWeight: "700" },
  drawerTabTextOn: { color: "#4ade80" },
  drawerClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  drawerBody: { flex: 1, overflow: "hidden" },
  // Bottom sheet (mobile)
  fab: {
    position: "absolute",
    right: Spacing.four,
    bottom: Spacing.four + 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#34d399",
  },
  frostRow: { borderWidth: 0 },
  fabText: { color: "#0c1210", fontSize: 14, fontWeight: "800" },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(4,8,12,0.5)" },
  sheet: {
    height: "84%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
    borderColor: "rgba(148,163,184,0.16)",
    overflow: "hidden",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: "rgba(148,163,184,0.4)",
    position: "absolute",
    top: 8,
    zIndex: 10,
  },
  sheetBody: { flex: 1 },
});

/** Planner card cap that adapts to narrow screens. */
function wideSafe(max: number): number {
  return max;
}
