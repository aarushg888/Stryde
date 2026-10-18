import { api, type RouteResult } from "@/api/api";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { WebBadge } from "@/components/web-badge";
import {
  BottomTabInset,
  Colors,
  MaxContentWidth,
  Spacing,
} from "@/constants/theme";
import { MaterialIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import MapView, {
  Marker,
  Polyline
} from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";

// MVP coverage area kept in sync with the backend's built graph (Logan Circle).
const DC_REGION = {
  latitude: 38.9137,
  longitude: -77.0325,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};
const DEMO_START = "38.9131,-77.0305";
const DEMO_GOAL = "38.9184,-77.0248";

const WALK_SPEED_KMH = 4.5;

function parseLatLng(
  value: string,
): { latitude: number; longitude: number } | null {
  const parts = value.split(",").map((part) => part.trim());

  if (parts.length !== 2) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

export default function HomeScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === "dark" ? "dark" : "light"];

  const [startLocation, setStartLocation] = useState("");
  const [destination, setDestination] = useState("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [svcState, setSvcState] = useState<
    "checking" | "online" | "warming" | "offline"
  >("checking");
  const [plannerExpanded, setPlannerExpanded] = useState(false);
  const mapRef = React.useRef<MapView>(null);
  const [mapPickMode, setMapPickMode] = useState<
    "start" | "destination" | null
  >(null);

  // Backend visibility pill: tells users whether the API is reachable before they type.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        setSvcState(h.ok ? (h.weights ? "online" : "warming") : "offline");
      } catch {
        if (alive) setSvcState("offline");
      }
    };

    const collapsePlanner = () => {
      if (!startLocation.trim() && !destination.trim()) {
        setPlannerExpanded(false);
        Keyboard.dismiss();
      }
    };

    void poll();
    const id = setInterval(poll, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const clearRoute = () => {
    setRoute(null);
    setRouteStatus(null);
    setRouteError(null);
  };

  const loadDemo = () => {
    setPlannerExpanded(true);
    setStartLocation(DEMO_START);
    setDestination(DEMO_GOAL);
    clearRoute();
  };

  const swapEnds = () => {
    setStartLocation(destination);
    setDestination(startLocation);
    clearRoute();
  };

  const handleFindRoute = async () => {
    Keyboard.dismiss();
    if (!startLocation.trim() || !destination.trim()) {
      setRouteStatus("Enter a start and a destination to plan a route.");
      return;
    }
    setFinding(true);
    setRoute(null);
    setRouteError(null);
    setRouteStatus("Finding the safest route…");
    try {
      const result = await api.searchRoute(
        startLocation.trim(),
        destination.trim(),
      );
      setRoute(result);
      const km = (result.total_cut_m / 1000).toFixed(2);
      const mins = Math.max(
        1,
        Math.round((result.total_cut_m / 1000 / WALK_SPEED_KMH) * 60),
      );
      const detour =
        result.straight_m && result.ratio
          ? ` · ${result.ratio}× straight line`
          : "";
      setRouteStatus(
        `${km} km · about ${mins} min${detour} · ${result.path.length} segments`,
      );
      if (result.geometry.length > 1) {
        mapRef.current?.fitToCoordinates(
          result.geometry.map(([lat, lng]) => ({
            latitude: lat,
            longitude: lng,
          })),
          {
            edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
            animated: true,
          },
        );
      }
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : "Route failed");
    } finally {
      setFinding(false);
    }
  };

  const startCoordinate = parseLatLng(startLocation);
  const destinationCoordinate = parseLatLng(destination);

  const routeCoords = route?.geometry?.length
    ? route.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
    : [];

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.mapCard, { borderColor: colors.backgroundElement }]}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={DC_REGION}
          showsUserLocation={false}
          showsMyLocationButton={false}
          toolbarEnabled={false}
          onPress={({ nativeEvent }) => {
            if (!mapPickMode) return;

            const { latitude, longitude } = nativeEvent.coordinate;
            const coordinates = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

            if (mapPickMode === "destination") {
              setDestination(coordinates);
            } else {
              setStartLocation(coordinates);
            }

            clearRoute();
            setPlannerExpanded(true);
            setMapPickMode(null);
          }}
        >
          {route && routeCoords.length > 1 && (
            <>
              <Polyline
                coordinates={routeCoords}
                strokeWidth={7}
                strokeColor="rgba(255,255,255,0.85)"
                lineCap="round"
                lineJoin="round"
              />
              <Polyline
                coordinates={routeCoords}
                strokeWidth={4}
                strokeColor={scheme === "dark" ? "#2ecc71" : "#27ae60"}
                lineCap="round"
                lineJoin="round"
              />
              <Marker
                coordinate={routeCoords[0]}
                title="Start"
                description={route.start_node}
                pinColor="#2ecc71"
              />
              <Marker
                coordinate={routeCoords[routeCoords.length - 1]}
                title="Destination"
                description={route.goal_node}
                pinColor="#e74c3c"
              />
            </>
          )}
          {!route && destinationCoordinate && (
            <Marker
              coordinate={destinationCoordinate}
              title="Destination"
              pinColor="#e74c3c"
            />
          )}

          {!route && startCoordinate && (
            <Marker
              coordinate={startCoordinate}
              title="Start"
              pinColor="#2ecc71"
            />
          )}
        </MapView>
      </View>

      {plannerExpanded && !route && !mapPickMode && (
        <View pointerEvents="none" style={styles.mapDimOverlay} />
      )}

      <View style={styles.foregroundContainer} pointerEvents="box-none">
        <KeyboardAvoidingView
          pointerEvents="box-none"
          style={styles.container}
          behavior={
            Platform.OS === "ios"
              ? "padding"
              : Platform.OS === "android"
                ? "height"
                : undefined
          }
        >
          <SafeAreaView
            pointerEvents="box-none"
            style={styles.safeArea}
            edges={["top", "left", "right"]}
          >
            <View
              style={styles.plannerContent}
              accessibilityLabel="Route planner"
            >
              <View style={styles.plannerCard} pointerEvents="auto">
                <View style={styles.plannerHeaderRow}>
                  {plannerExpanded && (
                    <TouchableOpacity
                      onPress={() => {
                        if (!startLocation.trim() && !destination.trim()) {
                          setPlannerExpanded(false);
                          Keyboard.dismiss();
                        }
                      }}
                      accessibilityLabel="Collapse route planner"
                      style={{ padding: 8 }}
                    >
                      <MaterialIcons name="close" size={20} color="#64748b" />
                    </TouchableOpacity>
                  )}

                  {/* <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={styles.plannerLabel}
                  >
                    Choose Your Destination
                  </ThemedText> */}
                  {/* {svcState !== "online" && (
                    <View
                      accessibilityLabel={`Backend status: ${svcState}`}
                      style={[
                        styles.svcPill,
                        svcState === "offline" && {
                          backgroundColor: "rgba(231,76,60,0.12)",
                        },
                        svcState === "warming" && {
                          backgroundColor: "rgba(15, 241, 83, 0.15)",
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.svcDot,
                          svcState === "offline" && {
                            backgroundColor: "#e74c3c",
                          },
                          svcState === "warming" && {
                            backgroundColor: "#2e9716",
                          },
                          svcState === "checking" && {
                            backgroundColor: "#888",
                          },
                        ]}
                      />
                      <ThemedText
                        style={[
                          styles.svcPillText,
                          svcState === "offline" && { color: "#e74c3c" },
                          svcState === "warming" && { color: "#2e9716" },
                        ]}
                      >
                        {svcState === "warming"
                          ? "Online"
                          : svcState === "offline"
                            ? "Backend offline"
                            : "Checking…"}
                      </ThemedText>
                    </View>
                  )} */}
                  {/* <TouchableOpacity
                    style={styles.textChip}
                    onPress={loadDemo}
                    accessibilityRole="button"
                    accessibilityLabel="Use demo locations"
                  >
                    <ThemedText style={styles.textChipText}>
                      Demo route
                    </ThemedText>
                  </TouchableOpacity> */}
                </View>

                {plannerExpanded && (
                  <View style={styles.mapPickRow}>
                    <TouchableOpacity
                      style={[
                        styles.mapPickButton,
                        mapPickMode === "destination" &&
                          styles.mapPickButtonActive,
                      ]}
                      onPress={() => setMapPickMode("destination")}
                    >
                      <MaterialIcons name="place" size={17} color="#e74c3c" />
                      <ThemedText style={styles.mapPickButtonText}>
                        {mapPickMode === "destination"
                          ? "Tap map to place red pin"
                          : "Pick destination"}
                      </ThemedText>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.mapPickButton,
                        mapPickMode === "start" && styles.mapPickButtonActive,
                      ]}
                      onPress={() => setMapPickMode("start")}
                    >
                      <MaterialIcons
                        name="my-location"
                        size={17}
                        color="#2ecc71"
                      />
                      <ThemedText style={styles.mapPickButtonText}>
                        {mapPickMode === "start"
                          ? "Tap map to place green pin"
                          : "Pick starting point"}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Start point */}
                {plannerExpanded && (
                  <>
                    <View style={styles.fieldRow}>
                      <View
                        style={[
                          styles.iconBadge,
                          { backgroundColor: "rgba(46, 204, 113, 0.12)" },
                        ]}
                      >
                        <MaterialIcons
                          name="my-location"
                          size={16}
                          color="#2ecc71"
                        />
                      </View>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            color: "#000000",
                            borderColor: colors.backgroundElement,
                          },
                        ]}
                        placeholder="Starting point (GPS, node id, or lat,lng)"
                        placeholderTextColor="#888"
                        value={startLocation}
                        onChangeText={(text) => {
                          setStartLocation(text);
                          clearRoute();
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="ascii-capable"
                        returnKeyType="next"
                        submitBehavior="blurAndSubmit"
                        accessibilityLabel="Starting point"
                        accessibilityHint="Type a graph node id or latitude,longitude pair"
                        enterKeyHint="next"
                      />
                      {startLocation.length > 0 && (
                        <TouchableOpacity
                          style={styles.clearButton}
                          onPress={() => {
                            setStartLocation("");
                            clearRoute();
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Clear starting point"
                        >
                          <MaterialIcons name="close" size={16} color="#888" />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Ends swap control */}
                    <TouchableOpacity
                      style={styles.swapButton}
                      onPress={swapEnds}
                      accessibilityRole="button"
                      accessibilityLabel="Swap starting point and destination"
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name="swap-vert"
                        size={18}
                        color="#3498db"
                      />
                    </TouchableOpacity>
                  </>
                )}

                {/* Destination */}
                <View style={styles.fieldRow}>
                  <View
                    style={[
                      styles.iconBadge,
                      { backgroundColor: "rgba(231, 76, 60, 0.12)" },
                    ]}
                  >
                    <MaterialIcons name="flag" size={16} color="#e74c3c" />
                  </View>
                  <TextInput
                    style={[
                      styles.input,

                      {
                        color: "#000000",
                        borderColor: colors.backgroundElement,
                      },
                    ]}
                    onFocus={() => setPlannerExpanded(true)}
                    placeholder="Destination (node id, or lat,lng)"
                    placeholderTextColor="#888"
                    value={destination}
                    onChangeText={(text) => {
                      setDestination(text);
                      clearRoute();
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="ascii-capable"
                    returnKeyType="go"
                    submitBehavior="submit"
                    onSubmitEditing={handleFindRoute}
                    accessibilityLabel="Destination"
                    accessibilityHint="Type a graph node id or latitude,longitude pair, then search"
                    enterKeyHint="go"
                  />
                  {destination.length > 0 && (
                    <TouchableOpacity
                      style={styles.clearButton}
                      onPress={() => {
                        setDestination("");
                        clearRoute();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Clear destination"
                    >
                      <MaterialIcons name="close" size={16} color="#888" />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Find route CTA */}
                {plannerExpanded && (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={handleFindRoute}
                    disabled={finding}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Find the safest pedestrian route"
                  >
                    <MaterialIcons
                      name="verified-user"
                      size={18}
                      color="#ffffff"
                    />
                    <ThemedText style={styles.actionButtonText}>
                      {finding ? "Routing…" : "Find safer route"}
                    </ThemedText>
                  </TouchableOpacity>
                )}
              </View>

              {/* Result / error banner */}
              {(routeError || routeStatus) && (
                <ThemedView
                  type="backgroundElement"
                  style={[
                    styles.statusCard,
                    routeError ? styles.statusCardError : null,
                  ]}
                >
                  <MaterialIcons
                    name={routeError ? "error-outline" : "route"}
                    size={18}
                    color={routeError ? "#e74c3c" : "#2ecc71"}
                  />
                  <ThemedText
                    style={[styles.statusText, { color: colors.text }]}
                    adjustsFontSizeToFit={false}
                  >
                    {routeError ?? routeStatus}
                  </ThemedText>
                </ThemedView>
              )}

              {Platform.OS === "web" && <WebBadge />}
            </View>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "transparent" },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    width: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.one,
  },
  headerSide: {
    width: 72,
  },
  headerTitle: {
    flex: 1,
    alignItems: "center",
  },
  dismissKeyboardButton: {
    width: 72,
    minHeight: 36,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.one,
  },
  title: {
    textAlign: "center",
    fontFamily: "HelveticaNeue-Bold",
    color: "#1A73E8",
  },
  tagline: {
    textAlign: "center",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "900",
    fontSize: 10,
    color: "#1A73E8",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    gap: Spacing.three,
    paddingBottom: Spacing.three,
  },
  plannerContent: {
    gap: Spacing.three,
  },
  mapCard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    height: "100%",
    width: "100%",
    borderRadius: 0,
    overflow: "hidden",
    borderWidth: 1,
    zIndex: 0,
    elevation: 0,
  },
  map: { width: "100%", height: "100%", top: 0, left: 0, right: 0, bottom: 0 },
  plannerCard: {
    gap: Spacing.two,
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    borderRadius: Spacing.three,
    padding: Spacing.three,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  plannerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  plannerLabel: {
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontSize: 11,
    top: -20,
    color: "#2563EB",
  },
  svcPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(149,165,166,0.15)",
    top: -15,
    left: 110,
  },
  svcDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2ecc71" },
  svcPillText: { fontSize: 11 },
  textChip: {
    borderWidth: 1,
    borderColor: "rgba(52, 152, 219, 0.4)",
    backgroundColor: "rgba(52, 152, 219, 0.1)",
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 36,
    justifyContent: "center",
    top: -9,
    left: -70,
  },
  textChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#3498db",
  },
  pickRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  pickChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(126, 123, 123, 0.35)",
    backgroundColor: "rgba(126, 123, 123, 0.08)",
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 40,
  },
  pickChipActive: {
    backgroundColor: "#3498db",
    borderColor: "#3498db",
  },
  pickChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  pickChipTextActive: {
    color: "#ffffff",
  },
  pickHint: {
    textAlign: "center",
    fontStyle: "italic",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: Spacing.three,
    justifyContent: "center",
    alignItems: "center",
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
    backgroundColor: "transparent",
    color: "#000000",
  },
  clearButton: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: Spacing.four,
  },
  foregroundContainer: {
    zIndex: 1,
    elevation: 1,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "absolute",
  },
  swapButton: {
    alignSelf: "center",
    width: 36,
    height: 36,
    marginTop: -Spacing.three,
    marginBottom: -Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: "rgba(52, 152, 219, 0.4)",
    backgroundColor: "rgba(52, 152, 219, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  actionButton: {
    width: "100%",
    height: 48,
    backgroundColor: "#2ecc71",
    borderRadius: Spacing.three,
    flexDirection: "row",
    gap: Spacing.one,
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.one,
  },
  actionButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  statusCard: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  statusCardError: {
    borderWidth: 1,
    borderColor: "rgba(231, 76, 60, 0.35)",
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontWeight: "500",
  },
  summaryCard: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  summaryRowLast: {
    paddingBottom: Spacing.one,
  },
  summaryDot: {
    width: 10,
    height: 10,
    borderRadius: Spacing.four,
    backgroundColor: "#2ecc71",
  },
  summaryDotGoal: { backgroundColor: "#e74c3c" },
  summaryText: {
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  summaryMeta: {
    lineHeight: 18,
  },
  helper: {
    textAlign: "center",
    opacity: 0.65,
    paddingBottom: BottomTabInset + Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  mapDimOverlay: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: "absolute",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    zIndex: 0,
  },
  mapPickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  mapPickButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  mapPickButtonActive: {
    borderColor: "#3498db",
    backgroundColor: "#eff6ff",
  },
  mapPickButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
});
