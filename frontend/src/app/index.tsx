import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  UserLocation,
  type CameraRef,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fetchCoverage, hasApi } from "../api/api";
//import { hazardLabel } from "../app/hazards";
//import { MAP_STYLE } from "../app/explore";
//import { PROFILES } from "../app/profiles";
/*import {
  distanceMeters,
  formatDistance,
  formatDuration,
  getRoutes,
  reverseGeocode,
  searchPlaces,
  toLngLat,
  YOUR_LOCATION,
  type LatLng,
  type Place,
} from "../stride/routing";
import { useStore } from "../stride/store";
import { colors, hairline, radius, shadow, space, type } from "../stride/theme";
import { Banner, Icon, PressableRow, PrimaryButton } from "../stride/ui";*/

const FALLBACK_LOCATION: LatLng = {
  latitude: 38.907938,
  longitude: -77.034397,
};

function routeFeature(coords: LatLng[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: coords.map(toLngLat),
    },
  };
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const store = useStore();

  const { origin, destination, routes, hazards, preferences } = store;

  const profile =
    PROFILES.find((p) => p.id === preferences.profileId) ?? PROFILES[0];

  const [me, setMe] = useState<LatLng | null>(null);
  const [coverageData, setCoverageData] = useState<any>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [fromText, setFromText] = useState(YOUR_LOCATION);
  const [toText, setToText] = useState("");
  const [editing, setEditing] = useState<"from" | "to" | null>(null);
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followOrigin, setFollowOrigin] = useState(true);
  const [trackUser, setTrackUser] = useState(true);
  const [didCenter, setDidCenter] = useState(false);
  const [panelH, setPanelH] = useState(168);

  // Load the supported pedestrian coverage area.
  useEffect(() => {
    if (!hasApi) return;

    let cancelled = false;

    async function loadCoverage() {
      try {
        const coverage = await fetchCoverage("demo");

        if (!cancelled && coverage?.geojson) {
          setCoverageData(coverage.geojson);
        }
      } catch (e) {
        console.warn("Could not load coverage:", e);
      }
    }

    void loadCoverage();

    return () => {
      cancelled = true;
    };
  }, []);

  // Request permission and track the user's actual GPS location.
  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    async function startLocationTracking() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (cancelled) return;

        if (permission.status !== "granted") {
          setHasPermission(false);
          setFollowOrigin(false);
          setFromText("");
          setLocNote(
            "Location permission denied. Search for a starting point or long-press the map.",
          );
          return;
        }

        setHasPermission(true);
        setLocNote(null);

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        if (cancelled) return;

        setMe({
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        });

        const nextSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 8,
            timeInterval: 3000,
          },
          (location) => {
            setMe({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            });
          },
        );

        if (cancelled) {
          nextSubscription.remove();
        } else {
          subscription = nextSubscription;
        }
      } catch (e) {
        if (!cancelled) {
          setHasPermission(false);
          setFollowOrigin(false);
          setLocNote(
            "Could not access your location. Search for a starting point instead.",
          );
        }
        console.warn("Location tracking failed:", e);
      }
    }

    void startLocationTracking();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  // Keep the route origin synchronized with GPS while following the user.
  useEffect(() => {
    if (!followOrigin || !me) return;

    const previous = origin?.coords;

    if (previous && distanceMeters(previous, me) < 20) return;

    store.setOrigin({
      label: YOUR_LOCATION,
      coords: me,
    });

    if (editing !== "from") {
      setFromText(YOUR_LOCATION);
    }
  }, [me, followOrigin]);

  // Initially center the map on the user's location or fallback region.
  useEffect(() => {
    if (didCenter) return;

    const center = me ?? FALLBACK_LOCATION;

    cameraRef.current?.flyTo({
      center: [center.longitude, center.latitude],
      zoom: 15.5,
      duration: 800,
    });

    setDidCenter(true);
  }, [me, didCenter]);

  // Load reported hazards from the existing store/API.
  useEffect(() => {
    if (hasApi) {
      void Promise.resolve(store.loadHazards()).catch((e) => {
        console.warn("Could not load hazards:", e);
      });
    }
  }, []);

  // Fetch route alternatives whenever the endpoints or preferences change.
  useEffect(() => {
    if (!origin || !destination) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadRoutes() {
      setLoading(true);
      setError(null);

      try {
        const found = await getRoutes(
          origin!.coords,
          destination!.coords,
          profile,
          {
            maxInclinePct: preferences.maxInclinePct,
            maxKerbM: preferences.maxKerbM,
            pavedOnly: preferences.pavedOnly,
          },
        );

        if (cancelled) return;

        store.setRoutes(found);

        if (found.length === 0) {
          store.setSelectedRouteId(null);
          setError("No routes were found for these locations.");
          return;
        }

        const existingSelection = found.some(
          (r) => r.id === store.selectedRouteId,
        );

        if (!existingSelection) {
          store.setSelectedRouteId(found[0].id);
        }
      } catch (e) {
        if (!cancelled) {
          store.setRoutes([]);
          setError(e instanceof Error ? e.message : "Could not get a route.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadRoutes();

    return () => {
      cancelled = true;
    };
  }, [
    origin,
    destination,
    preferences.profileId,
    preferences.maxInclinePct,
    preferences.maxKerbM,
    preferences.pavedOnly,
  ]);

  // Fit the camera to route geometry only when usable coordinates exist.
  useEffect(() => {
    if (routes.length === 0) return;

    const all = routes.flatMap((route) => route.coords);

    if (all.length === 0) return;

    const lngs = all.map((point) => point.longitude);
    const lats = all.map((point) => point.latitude);

    cameraRef.current?.fitBounds(
      [
        Math.min(...lngs),
        Math.min(...lats),
        Math.max(...lngs),
        Math.max(...lats),
      ],
      {
        padding: {
          top: 170,
          bottom: Math.max(panelH, 220),
          left: 48,
          right: 48,
        },
        duration: 700,
      },
    );

    setTrackUser(false);
  }, [routes, panelH]);

  // Debounced place search.
  useEffect(() => {
    const query =
      editing === "from" ? fromText : editing === "to" ? toText : "";

    if (!editing) {
      setResults([]);
      setSearching(false);
      return;
    }

    const trimmed = query.trim();

    if (
      trimmed.length < 2 ||
      (editing === "from" && trimmed === YOUR_LOCATION)
    ) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;

    const timeout = setTimeout(async () => {
      setSearching(true);

      try {
        const found = await searchPlaces(trimmed, me ?? origin?.coords ?? null);

        if (!cancelled) {
          setResults(found);
        }
      } catch (e) {
        if (!cancelled) {
          setError("Place search failed. Check your connection.");
        }
        console.warn("Place search failed:", e);
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [fromText, toText, editing, me, origin?.coords]);

  const flyToPlace = useCallback((place: Place, zoom = 16) => {
    cameraRef.current?.flyTo({
      center: [place.coords.longitude, place.coords.latitude],
      zoom,
      duration: 650,
    });

    setTrackUser(false);
  }, []);

  const pickFrom = (place: Place, isMe: boolean) => {
    Keyboard.dismiss();
    setFollowOrigin(isMe);
    store.setOrigin(place);
    setFromText(place.label);
    setResults([]);
    setEditing(null);
    setError(null);

    if (!destination) {
      flyToPlace(place);
    }
  };

  const pickTo = (place: Place) => {
    Keyboard.dismiss();
    store.setDestination(place);
    setToText(place.label);
    setResults([]);
    setEditing(null);
    setError(null);
    flyToPlace(place);
  };

  const onLongPress = async (event: {
    nativeEvent: { lngLat: [number, number] };
  }) => {
    const [longitude, latitude] = event.nativeEvent.lngLat;

    const coords: LatLng = {
      latitude,
      longitude,
    };

    try {
      const label = await reverseGeocode(coords);
      const place: Place = { label, coords };

      if (editing === "from") {
        pickFrom(place, false);
      } else {
        pickTo(place);
      }
    } catch (e) {
      console.warn("Reverse geocoding failed:", e);

      const place: Place = {
        label: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        coords,
      };

      if (editing === "from") {
        pickFrom(place, false);
      } else {
        pickTo(place);
      }
    }
  };

  const clearTo = () => {
    store.setDestination(null);
    store.setRoutes([]);
    store.setSelectedRouteId(null);
    setToText("");
    setResults([]);
    setEditing(null);
    setError(null);
  };

  const useMyLocation = () => {
    if (!me) {
      setLocNote("Waiting for a GPS fix. You can also search for a start.");
      return;
    }

    pickFrom({ label: YOUR_LOCATION, coords: me }, true);

    cameraRef.current?.flyTo({
      center: [me.longitude, me.latitude],
      zoom: 16,
      duration: 500,
    });

    setTrackUser(true);
  };

  const recenter = () => {
    if (!me) {
      setLocNote("Your current location is not available yet.");
      return;
    }

    cameraRef.current?.flyTo({
      center: [me.longitude, me.latitude],
      zoom: 16,
      duration: 450,
    });

    setTrackUser(true);
  };

  const swapEnds = () => {
    if (!origin && !destination) return;

    const nextFrom = destination;

    const nextTo = followOrigin
      ? me
        ? { label: YOUR_LOCATION, coords: me }
        : origin
      : origin;

    setFollowOrigin(false);
    store.setOrigin(nextFrom);
    store.setDestination(nextTo ?? null);
    setFromText(nextFrom?.label ?? "");
    setToText(nextTo?.label ?? "");
    setResults([]);
    setEditing(null);
    setError(null);
    store.setRoutes([]);
    store.setSelectedRouteId(null);
  };

  const demo = routes.some((route) => route.demo);
  const selectedId = store.selectedRouteId ?? routes[0]?.id;
  const showYourLocationRow = editing === "from" && !!me;
  const canRoute = !!origin && !!destination;

  return (
    <View style={styles.fill}>
      <Map
        ref={mapRef}
        style={styles.fill}
        mapStyle={MAP_STYLE}
        compass
        compassPosition={{ top: insets.top + 148, right: 12 }}
        attributionPosition={{ top: insets.top + 8, right: 8 }}
        logo={false}
        onPress={() => {
          Keyboard.dismiss();
          setEditing(null);
          setResults([]);
        }}
        onLongPress={onLongPress}
        onRegionDidChange={(event) => {
          if (event.nativeEvent.userInteraction) {
            setTrackUser(false);
          }
        }}
        onDidFailLoadingMap={() => setTilesFailed(true)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [FALLBACK_LOCATION.longitude, FALLBACK_LOCATION.latitude],
            zoom: 15.5,
          }}
          minZoom={2}
          maxZoom={20}
          trackUserLocation={trackUser && hasPermission ? "default" : undefined}
        />

        {hasPermission && <UserLocation />}

        {coverageData && (
          <GeoJSONSource id="stryde-coverage" data={coverageData}>
            <Layer
              type="line"
              id="stryde-coverage-line"
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
              paint={{
                "line-color": "#4A90E2",
                "line-width": 1.8,
                "line-opacity": 0.5,
              }}
            />
          </GeoJSONSource>
        )}

        {origin && !followOrigin && (
          <Marker id="origin" lngLat={toLngLat(origin.coords)}>
            <View style={styles.originPin} accessibilityLabel="Start marker">
              <View style={styles.originPinDot} />
            </View>
          </Marker>
        )}

        {destination && (
          <Marker id="destination" lngLat={toLngLat(destination.coords)}>
            <View
              style={styles.destPin}
              accessibilityLabel="Destination marker"
            />
          </Marker>
        )}

        {hazards.map((hazard) => (
          <Marker
            key={hazard.id}
            id={hazard.id}
            lngLat={toLngLat(hazard.coords)}
          >
            <View
              style={styles.hazardDot}
              accessibilityLabel={`Reported hazard: ${hazardLabel(hazard.type)}`}
            />
          </Marker>
        ))}

        {routes.map((route) =>
          route.coords.length > 1 ? (
            <GeoJSONSource
              key={route.id}
              id={`route-${route.id}`}
              data={routeFeature(route.coords)}
            >
              <Layer
                type="line"
                id={`route-${route.id}-line`}
                layout={{
                  "line-cap": "round",
                  "line-join": "round",
                }}
                paint={{
                  "line-color":
                    route.id === selectedId
                      ? route.id === "stryde" || route.id === "accessible"
                        ? colors.green
                        : colors.standardRoute
                      : colors.line,
                  "line-width": route.id === selectedId ? 6.5 : 4.5,
                  "line-opacity": route.id === selectedId ? 0.95 : 0.4,
                  "line-dasharray":
                    route.id === "accessible" || route.id === "stryde"
                      ? [1, 0]
                      : [2, 1.4],
                }}
              />
            </GeoJSONSource>
          ) : null,
        )}
      </Map>

      <View style={[styles.searchWrap, { top: insets.top + 10 }]}>
        <View style={styles.searchCard}>
          <View style={styles.stopRow}>
            <View style={[styles.stopDot, { backgroundColor: colors.green }]} />

            <TextInput
              style={styles.input}
              value={fromText}
              onChangeText={(value) => {
                setFromText(value);
                setEditing("from");
                setError(null);
              }}
              onFocus={() => setEditing("from")}
              placeholder="Start (or long-press map)"
              placeholderTextColor={colors.inkSoft}
              returnKeyType="search"
              accessibilityLabel="Start"
              autoCorrect={false}
            />
          </View>

          <View style={styles.searchDivider} />

          <View style={styles.stopRow}>
            <View style={[styles.stopDot, { backgroundColor: colors.ink }]} />

            <TextInput
              style={styles.input}
              value={toText}
              onChangeText={(value) => {
                setToText(value);
                setEditing("to");
                setError(null);
              }}
              onFocus={() => setEditing("to")}
              placeholder="Destination (or long-press map)"
              placeholderTextColor={colors.inkSoft}
              returnKeyType="search"
              accessibilityLabel="Destination"
              autoCorrect={false}
            />

            {destination ? (
              <PressableRow
                onPress={clearTo}
                accessibilityLabel="Clear destination"
                style={styles.iconBtn}
              >
                <Icon
                  ios="xmark.circle.fill"
                  android="cancel"
                  color={colors.inkSoft}
                  size={20}
                />
              </PressableRow>
            ) : null}
          </View>

          <PressableRow
            onPress={swapEnds}
            accessibilityRole="button"
            accessibilityLabel="Swap start and destination"
            style={styles.swap}
          >
            <Icon
              ios="arrow.up.arrow.down"
              android="swap_vert"
              color={colors.green}
              size={18}
            />
          </PressableRow>
        </View>

        {(showYourLocationRow ||
          results.length > 0 ||
          searching ||
          (editing === "to" && !searching && results.length === 0)) && (
          <View style={styles.resultsCard}>
            {showYourLocationRow && (
              <PressableRow
                style={styles.resultRow}
                onPress={useMyLocation}
                accessibilityRole="button"
                accessibilityLabel="Use your current location"
              >
                <Icon
                  ios="location.fill"
                  android="my_location"
                  color={colors.green}
                  size={16}
                />

                <View style={{ flex: 1 }}>
                  <Text style={styles.resultText}>{YOUR_LOCATION}</Text>
                  <Text style={type.caption}>Use GPS as the start</Text>
                </View>
              </PressableRow>
            )}

            {searching && (
              <View style={styles.resultRow}>
                <ActivityIndicator color={colors.green} />
                <Text style={type.caption}>Searching places…</Text>
              </View>
            )}

            {editing === "to" && !searching && results.length === 0 && (
              <>
                <PressableRow
                  style={styles.resultRow}
                  onPress={() => {
                    Keyboard.dismiss();
                    setFollowOrigin(false);

                    const start: Place = {
                      label: "14th & N St NW (Logan Circle)",
                      coords: {
                        latitude: 38.907938,
                        longitude: -77.034397,
                      },
                    };

                    const end: Place = {
                      label: "16th & Q St NW (Logan Circle)",
                      coords: {
                        latitude: 38.910488,
                        longitude: -77.036417,
                      },
                    };

                    store.setOrigin(start);
                    store.setDestination(end);
                    setFromText(start.label);
                    setToText(end.label);
                    setResults([]);
                    setEditing(null);
                    setError(null);
                    flyToPlace(end);
                  }}
                  accessibilityRole="button"
                >
                  <Icon
                    ios="arrow.triangle.turn.up.right.diamond.fill"
                    android="directions_walk"
                    color={colors.green}
                    size={16}
                  />

                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultText}>
                      Demo: Logan Circle Walk (14th St to 16th St)
                    </Text>
                    <Text style={type.caption}>
                      Demo route in the Stryde coverage area
                    </Text>
                  </View>
                </PressableRow>

                <PressableRow
                  style={[styles.resultRow, styles.resultBorder]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setFollowOrigin(false);

                    const start: Place = {
                      label: "15th & M St NW",
                      coords: {
                        latitude: 38.907675,
                        longitude: -77.035538,
                      },
                    };

                    const end: Place = {
                      label: "15th & Massachusetts Ave NW",
                      coords: {
                        latitude: 38.907591,
                        longitude: -77.035501,
                      },
                    };

                    store.setOrigin(start);
                    store.setDestination(end);
                    setFromText(start.label);
                    setToText(end.label);
                    setResults([]);
                    setEditing(null);
                    setError(null);
                    flyToPlace(end);
                  }}
                  accessibilityRole="button"
                >
                  <Icon
                    ios="arrow.triangle.turn.up.right.diamond.fill"
                    android="directions_walk"
                    color={colors.green}
                    size={16}
                  />

                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultText}>
                      Demo: 15th St Sidewalk Crosswalk
                    </Text>
                    <Text style={type.caption}>
                      Demo route in the Stryde coverage area
                    </Text>
                  </View>
                </PressableRow>
              </>
            )}

            {results.map((place, index) => (
              <PressableRow
                key={`${place.label}-${index}`}
                style={[styles.resultRow, styles.resultBorder]}
                onPress={() =>
                  editing === "from" ? pickFrom(place, false) : pickTo(place)
                }
                accessibilityRole="button"
              >
                <Icon
                  ios="mappin"
                  android="location_on"
                  color={colors.inkSoft}
                  size={16}
                />

                <Text style={styles.resultText} numberOfLines={2}>
                  {place.label}
                </Text>
              </PressableRow>
            ))}
          </View>
        )}

        {locNote && <Banner>{locNote}</Banner>}

        {tilesFailed && (
          <Banner tone="warn">
            Map tiles failed to load. Check your connection and map style.
          </Banner>
        )}

        {error && <Banner tone="warn">{error}</Banner>}
      </View>

      <PressableRow
        onPress={recenter}
        accessibilityRole="button"
        accessibilityLabel="Recenter on my location"
        style={[styles.fab, shadow, { bottom: panelH + 12 }]}
      >
        <Icon
          ios={trackUser ? "location.fill" : "location"}
          android="my_location"
          color={trackUser ? colors.green : colors.ink}
          size={22}
        />
      </PressableRow>

      <View
        style={[
          styles.panel,
          { paddingBottom: Math.max(insets.bottom, 12) + 8 },
        ]}
        onLayout={(event) => setPanelH(event.nativeEvent.layout.height)}
      >
        <View style={styles.handle} />

        <PrimaryButton
          label={
            canRoute
              ? "Compare routes"
              : origin
                ? "Search a destination"
                : "Choose start and destination"
          }
          disabled={!canRoute || loading}
          onPress={() => router.push("/routes")}
          accessibilityLabel="Find a safer route"
        />

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.green} />
            <Text style={type.caption}>Finding routes…</Text>
          </View>
        )}

        {routes.length > 0 && !loading && (
          <View style={styles.summary}>
            {routes.slice(0, 2).map((route) => (
              <View key={route.id} style={styles.summaryRow}>
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor:
                        route.id === "stryde" || route.id === "accessible"
                          ? colors.green
                          : colors.standardRoute,
                    },
                  ]}
                />

                <Text style={styles.summaryText}>
                  {route.label}
                  <Text style={styles.summaryMeta}>
                    {"  "}
                    {formatDistance(route.distanceM)} ·{" "}
                    {formatDuration(route.durationS)}
                  </Text>
                </Text>
              </View>
            ))}

            {demo && (
              <Text
                style={[type.caption, { color: colors.amber, marginTop: 4 }]}
              >
                Demo routes. Configure EXPO_PUBLIC_ORS_KEY for live routing.
              </Text>
            )}
          </View>
        )}

        <View style={styles.links}>
          <PressableRow
            style={styles.link}
            onPress={() => router.push("/preferences")}
            accessibilityRole="button"
            accessibilityLabel="Walking preferences"
          >
            <Icon
              ios="slider.horizontal.3"
              android="tune"
              color={colors.green}
              size={18}
            />
            <Text style={styles.linkText}>Preferences</Text>
          </PressableRow>

          <PressableRow
            style={styles.link}
            onPress={() => router.push("/report")}
            accessibilityRole="button"
            accessibilityLabel="Report a hazard"
          >
            <Icon
              ios="exclamationmark.triangle"
              android="report"
              color={colors.green}
              size={18}
            />
            <Text style={styles.linkText}>Report hazard</Text>
          </PressableRow>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: "#d8e2d9",
  },
  searchWrap: {
    position: "absolute",
    left: 16,
    right: 16,
  },
  searchCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: "hidden",
    ...shadow,
  },
  stopRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 10,
  },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  searchDivider: {
    height: hairline,
    backgroundColor: colors.line,
    marginLeft: 32,
    marginRight: 48,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    minWidth: 80,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  swap: {
    position: "absolute",
    right: 8,
    top: 36,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.paper,
    borderWidth: hairline,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  resultsCard: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: hairline,
    borderColor: colors.line,
    overflow: "hidden",
    ...shadow,
  },
  resultRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resultBorder: {
    borderTopWidth: hairline,
    borderTopColor: colors.line,
  },
  resultText: {
    ...type.body,
    flex: 1,
    fontSize: 15,
  },
  originPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  originPinDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
  },
  destPin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.ink,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  hazardDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.amber,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  fab: {
    position: "absolute",
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: hairline,
    borderColor: colors.line,
  },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: 8,
    gap: 12,
    ...shadow,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: 4,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summary: {
    gap: 6,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 24,
  },
  swatch: {
    width: 4,
    height: 18,
    borderRadius: 2,
  },
  summaryText: {
    ...type.callout,
    fontWeight: "600",
  },
  summaryMeta: {
    fontWeight: "400",
    color: colors.inkSoft,
  },
  links: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  link: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingRight: 8,
  },
  linkText: {
    color: colors.green,
    fontWeight: "600",
    fontSize: 15,
  },
});
