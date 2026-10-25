import { api, RouteResult } from "@/api/api";
import { ThemedView } from "@/components/themed-view";
import {
  BottomTabInset,
  Colors,
  MaxContentWidth,
  Spacing,
} from "@/constants/theme";
import { MaterialIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { AppMap } from "@/components/app-map";
import type { AppMapHandle } from "@/components/app-map-types";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePlaceSearch } from "@/hooks/use-place-search";
import { DC_REGION, parseLatLng } from "@/utils/geo";

const ROUTE_META = [
  { title: "Safest route", tag: "Recommended", color: "#2ecc71" },
  { title: "Balanced route", tag: "Moderate risk", color: "#f1c40f" },
  { title: "Shortest route", tag: "Higher risk", color: "#e74c3c" },
] as const;
const WALK_SPEED_KMH = 4.5;
export default function HomeScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === "dark" ? "dark" : "light"];

  const [startLocation, setStartLocation] = useState("");
  const [destination, setDestination] = useState("");
  const [startLocationCoords, setStartLocationCoords] = useState("");
  const [destinationCoords, setDestinationCoords] = useState("");
  const [routes, setRoutes] = useState<RouteResult | null>(null);
  const [curr, setCurr] = useState<number>(0);
  const [routeCoords, setRouteCoords] =
    useState<{ latitude: number; longitude: number }[][]>();
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [svcState, setSvcState] = useState<
    "checking" | "online" | "warming" | "offline"
  >("checking");
  const { height: windowHeight } = useWindowDimensions();
  const [plannerExpanded, setPlannerExpanded] = useState(false);
  const mapRef = React.useRef<AppMapHandle>(null);
  const [mapPickMode, setMapPickMode] = useState<
    "start" | "destination" | null
  >(null);
  const [mode, setMode] = useState<
    "initial" | "select-destination" | "select-start" | "done"
  >("initial");
  const [routesVisible, setRoutesVisible] = useState(false);
  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        console.log("Location permission denied");
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude } = location.coords;

      setStartLocation("Your location");
      setStartLocationCoords(`${latitude},${longitude}`);
    } catch (error) {
      console.error("Location error:", error);
    }
  };
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
    setRoutes(null);
    setRouteStatus(null);
    setRouteError(null);
    setCurr(0);
    setRouteCoords(undefined);
  };

  const swapEnds = () => {
    setStartLocationCoords(destinationCoords);
    setDestinationCoords(startLocationCoords);
    clearRoute();
  };

  const handleFindRoute = async () => {
    Keyboard.dismiss();
    if (!startLocationCoords.trim() || !destinationCoords.trim()) {
      setRouteStatus("Enter a start and a destination to plan a route.");
      return;
    }
    setFinding(true);
    setRoutes(null);
    setRouteError(null);
    setCurr(0);
    setRouteStatus("Finding the safest route…");
    try {
      const result = await api.searchRoute(
        startLocationCoords.trim(),
        destinationCoords.trim(),
      );
      setRoutes(result);
      const coordArr: { latitude: number; longitude: number }[][] = [];
      for (const path of result.paths) {
        const km = (path.total_cut_m / 1000).toFixed(2);
        const mins = Math.max(
          1,
          Math.round((path.total_cut_m / 1000 / WALK_SPEED_KMH) * 60),
        );
        setRouteStatus(`${km} km · about ${mins} min`);
        coordArr.push(
          path.geometry.map(([lat, lng]) => ({
            latitude: lat,
            longitude: lng,
          })),
        );
        if (path.geometry.length > 1) {
          mapRef.current?.fitToCoordinates(
            path.geometry.map(([lat, lng]) => ({
              latitude: lat,
              longitude: lng,
            })),
            {
              edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
              animated: true,
            },
          );
        }
        setRouteCoords(coordArr);
      }
      setAlternateRoutes(true);
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : "Route failed");
    } finally {
      setFinding(false);
    }
  };
  const [generateRoutes, setGenerateRoutes] = useState(false);
  const startCoordinate = parseLatLng(startLocationCoords);
  const destinationCoordinate = parseLatLng(destinationCoords);
  const inputRef = React.useRef<TextInput>(null);
  const inputRef2 = React.useRef<TextInput>(null);
  const [firstState, setFirstState] = useState(true);
  // const routeCoords = route?.geometry?.length
  //   ? route.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
  //   : [];
  // Debounced place search shared by both inputs (start & destination).
  const activeQuery =
    mode === "select-destination"
      ? destination
      : mode === "select-start"
        ? startLocation
        : "";
  const { suggestions, searching, clearSuggestions } = usePlaceSearch(
    activeQuery,
    mode === "select-destination" || mode === "select-start",
  );
  const [alternateRoutes, setAlternateRoutes] = useState(false);
  const updateStartLocation = (value: string) => {
    if (value.length > 15) {
      value = value.substring(0, 15);
    }
    setStartLocation(value);
    setAlternateRoutes(false);
    setGenerateRoutes(true);
  };
  const updateDestination = (value: string) => {
    if (value.length > 15) {
      value = value.substring(0, 15);
    }
    setDestination(value);
    setAlternateRoutes(false);
    setGenerateRoutes(true);
  };
  return (
    <ThemedView style={styles.container}>
      {(mode == "initial" || mode == "done") && (
        <View
          style={[styles.mapCard, { borderColor: colors.backgroundElement }]}
        >
          <AppMap
            ref={mapRef}
            style={styles.map}
            initialRegion={DC_REGION}
            onPressPick={(latitude, longitude) => {
              if (!mapPickMode) return;

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
            routes={
              routeCoords && routes
                ? routeCoords.map((coordinates, i) => ({
                    coordinates,
                    color: ROUTE_META[Math.min(i, ROUTE_META.length - 1)].color,
                    selected: i === curr,
                  }))
                : undefined
            }
            markers={[
              ...(destinationCoordinate
                ? [
                    {
                      coordinate: destinationCoordinate,
                      title: "Destination",
                      color: "#e74c3c",
                    },
                  ]
                : []),
              ...(startCoordinate
                ? [{ coordinate: startCoordinate, title: "Start", color: "#2ecc71" }]
                : []),
            ]}
          />
        </View>
      )}
      {(mode == "select-destination" || mode == "select-start") && (
        <View></View>
      )}

      {plannerExpanded && !mapPickMode && !routeCoords && (
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
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 5,
              }}
            >
              <TouchableOpacity
                style={{
                  paddingVertical: 12,
                  opacity:
                    mode === "select-destination" || mode === "select-start"
                      ? 1
                      : 0,
                }}
                onPress={() => {
                  // (inputRef.current as unknown as { blur?(): void })?.blur?.();
                  // (inputRef2.current as unknown as { blur?(): void })?.blur?.();
                  Keyboard.dismiss();
                  setMode("initial");
                }}
              >
                <MaterialIcons
                  name="close"
                  size={24}
                  color="#fdf7f7"
                  style={{
                    marginLeft: 5,
                  }}
                />
              </TouchableOpacity>
              <View
                style={{ flexDirection: "column", justifyContent: "center" }}
              >
                {(mode === "initial" || mode == "select-start") && (
                  <TextInput
                    maxLength={15}
                    autoCorrect={false}
                    placeholder="Enter start..."
                    style={{
                      width: "100%",
                      paddingVertical: 12,
                      paddingHorizontal: 20,
                      marginBottom: 20,
                      backgroundColor: "#353131",
                      color: "#cfc5c5",
                      fontSize: 16,
                      borderRadius: 24,
                      textAlign: "center",
                    }}
                    placeholderTextColor="#cfc5c5"
                    onChangeText={updateStartLocation}
                    value={startLocation}
                    onFocus={() => setMode("select-start")}
                  />
                )}
                {((mode === "initial" && startLocationCoords !== "") ||
                  mode == "select-destination") && (
                  <TextInput
                    autoCorrect={false}
                    maxLength={15}
                    placeholder="Enter destination..."
                    style={{
                      width: "100%",
                      paddingVertical: 12,
                      paddingHorizontal: 20,
                      backgroundColor: "#353131",
                      color: "#cfc5c5",
                      fontSize: 16,
                      borderRadius: 24,
                      textAlign: "center",
                    }}
                    placeholderTextColor="#cfc5c5"
                    onChangeText={updateDestination}
                    value={destination}
                    onFocus={() => setMode("select-destination")}
                  />
                )}
              </View>

              <View
                style={{
                  paddingVertical: 12,
                  opacity: 0,
                }}
              >
                <MaterialIcons name="close" size={24} color="black" />
              </View>
            </View>
            {mode === "select-destination" && (
              <View style={styles.suggestionsContainer}>
                {searching && (
                  <ActivityIndicator color="#2ecc71" style={{ padding: 12 }} />
                )}

                {suggestions.map((item, index) => (
                  <TouchableOpacity
                    key={`${item.lat}-${item.lng}-${index}`}
                    style={styles.suggestionRow}
                    onPress={async () => {
                      let value = item.name;
                      if (value.length > 15) {
                        value = value.substring(0, 15);
                      }
                      setAlternateRoutes(false);
                      setGenerateRoutes(true);
                      setDestination(value);
                      setDestinationCoords(`${item.lat},${item.lng}`);
                      clearSuggestions();

                      (inputRef.current as unknown as { blur?(): void })?.blur?.();
                      Keyboard.dismiss();
                      setMode("initial");
                      // if (firstState) {
                      //   await getCurrentLocation();
                      //   setFirstState(false);
                      // }
                    }}
                  >
                    <MaterialIcons
                      name="location-on"
                      size={22}
                      color="#2ecc71"
                    />

                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionTitle}>{item.name}</Text>

                      <Text style={styles.suggestionSubtitle}>
                        {[item.city, item.administrative]
                          .filter(Boolean)
                          .join(", ")}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {mode === "select-start" && (
              <View style={styles.suggestionsContainer}>
                {searching && (
                  <ActivityIndicator color="#2ecc71" style={{ padding: 12 }} />
                )}

                {suggestions.map((item, index) => (
                  <TouchableOpacity
                    key={`${item.lat}-${item.lng}-${index}`}
                    style={styles.suggestionRow}
                    onPress={async () => {
                      let value = item.name;
                      if (value.length > 15) {
                        value = value.substring(0, 15);
                      }
                      setAlternateRoutes(false);
                      setGenerateRoutes(true);
                      setStartLocation(value);
                      setStartLocationCoords(`${item.lat},${item.lng}`);
                      clearSuggestions();

                      // (inputRef2.current as unknown as { blur?(): void })?.blur?.();
                      // Keyboard.dismiss();
                      setMode("select-destination");

                      // await getCurrentLocation();
                    }}
                  >
                    <MaterialIcons
                      name="location-on"
                      size={22}
                      color="#2ecc71"
                    />

                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionTitle}>{item.name}</Text>

                      <Text style={styles.suggestionSubtitle}>
                        {[item.city, item.administrative]
                          .filter(Boolean)
                          .join(", ")}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {/* {(mode == "initial" || mode == "done") && generateRoutes && (
              <View
                style={{
                  position: "absolute",
                  bottom: BottomTabInset + 20,
                  left: 20,
                  right: 20,
                }}
              >
                <TouchableOpacity
                  onPress={handleFindRoute}
                  disabled={finding}
                  style={{
                    backgroundColor: "#2ecc71",
                    paddingVertical: 16,
                    borderRadius: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    opacity: finding ? 0.6 : 1,
                  }}
                >
                  {finding ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <MaterialIcons
                      name="directions-walk"
                      size={24}
                      color="#ffffff"
                    />
                  )}

                  <Text
                    style={{
                      color: "#ffffff",
                      fontSize: 17,
                      fontWeight: "700",
                    }}
                  >
                    {finding ? "Finding routes..." : "Find Routes"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            {alternateRoutes && (mode == "initial" || mode == "done") && (
              <View
                style={{
                  position: "absolute",
                  bottom: BottomTabInset + 20,
                  left: 20,
                  right: 20,
                }}
              >
                <TouchableOpacity
                  onPress={() => {
                    setRoutesVisible(true);
                  }}
                  disabled={routesVisible}
                  style={{
                    backgroundColor: "#2ecc71",
                    paddingVertical: 16,
                    borderRadius: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    opacity: finding ? 0.6 : 1,
                  }}
                >
                  <Text
                    style={{
                      color: "#ffffff",
                      fontSize: 17,
                      fontWeight: "700",
                    }}
                  >
                    View Alternate Routes
                  </Text>
                </TouchableOpacity>
              </View>
            )} */}
            {(mode === "initial" || mode === "done") &&
              (generateRoutes || alternateRoutes) && (
                <View
                  style={{
                    position: "absolute",
                    bottom: BottomTabInset + 20,
                    left: 20,
                    right: 20,
                  }}
                >
                  <TouchableOpacity
                    disabled={finding}
                    onPress={() => {
                      if (alternateRoutes) {
                        setRoutesVisible(true);
                      } else {
                        void handleFindRoute();
                      }
                    }}
                    style={{
                      backgroundColor: "#2ecc71",
                      paddingVertical: 16,
                      borderRadius: 16,
                      alignItems: "center",
                      opacity: finding ? 0.6 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: "#ffffff",
                        fontSize: 17,
                        fontWeight: "700",
                      }}
                    >
                      {finding
                        ? "Finding routes..."
                        : alternateRoutes
                          ? "View Alternate Routes"
                          : "Find Routes"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
      {/* <BottomSheet
        isPresented={routesVisible}
        onDismiss={() => setRoutesVisible(false)}
        snapPoints={["half", "full"]}
        containerColor="#242424"
      >
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={{ color: "white", fontSize: 22, marginBottom: 20 }}>
            Choose a route
          </Text>

          {routes?.paths.map((route, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => {
                setCurr(i);
                setRoutesVisible(false);
              }}
              style={{
                backgroundColor: curr === i ? "#08751a" : "#353131",
                padding: 16,
                borderRadius: 12,
                marginBottom: 12,
              }}
            >
              <Text style={{ color: "white", fontSize: 16 }}>
                {ROUTE_META[i]?.title ?? `Route ${i + 1}`}
              </Text>
              <Text style={{ color: "#aaaaaa" }}>
                {(route.total_cut_m / 1000).toFixed(2)} km
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </BottomSheet> */}
      {/* <BottomSheet
        isPresented={routesVisible}
        onDismiss={() => setRoutesVisible(false)}
      >
        <Column spacing={12}>
          <UIText>Choose a route</UIText>
        </Column>
      </BottomSheet> */}
      <Modal
        visible={routesVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRoutesVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          {/* Tap outside the sheet to dismiss */}
          <Pressable
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onPress={() => setRoutesVisible(false)}
          />

          <View
            style={{
              backgroundColor: "#242424",
              maxHeight: "60%",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
          >
            {/* Header with close button */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 20,
                paddingTop: 16,
              }}
            >
              <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>
                Choose a route
              </Text>
              <TouchableOpacity
                onPress={() => setRoutesVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialIcons name="close" size={24} color="#cfc5c5" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20 }}>
              {routes?.paths.map((route, i) => {
                const meta = ROUTE_META[Math.min(i, ROUTE_META.length - 1)];
                const km = (route.total_cut_m / 1000).toFixed(2);
                const mins = Math.max(
                  1,
                  Math.round((route.total_cut_m / 1000 / WALK_SPEED_KMH) * 60),
                );

                return (
                  <TouchableOpacity
                    key={`route-${i}`}
                    onPress={() => {
                      setCurr(i);
                      if (routeCoords?.[i]?.length) {
                        mapRef.current?.fitToCoordinates(routeCoords[i], {
                          edgePadding: {
                            top: 120,
                            right: 60,
                            bottom: windowHeight * 0.6,
                            left: 60,
                          },
                          animated: true,
                        });
                      }
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: i === curr ? "#08751a" : "#353131",
                      padding: 16,
                      borderRadius: 12,
                      marginBottom: 12,
                    }}
                  >
                    <View>
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 16,
                          fontWeight: "600",
                        }}
                      >
                        {meta.title}
                      </Text>
                      <Text
                        style={{
                          color: meta.color,
                          fontSize: 12,
                          fontWeight: "600",
                        }}
                      >
                        {meta.tag}
                      </Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 16,
                          fontWeight: "700",
                        }}
                      >
                        {mins} min
                      </Text>
                      <Text style={{ color: "#aaaaaa", fontSize: 12 }}>
                        {km} km
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  suggestionsContainer: {
    marginTop: 25,
    backgroundColor: "#242424",
    borderRadius: 16,
    overflow: "hidden",
    zIndex: 100,
    elevation: 10,
  },

  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#454545",
  },

  suggestionTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },

  suggestionSubtitle: {
    color: "#aaaaaa",
    fontSize: 12,
    marginTop: 3,
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
  backgroundStyle: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: "100%",
    backgroundColor: "black",
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
