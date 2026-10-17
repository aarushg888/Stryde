import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  UserLocation,
  type CameraRef,
  type MapRef,
  type PressEvent as MapPressEvent,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../stride/colors';
import { PROFILES } from '../stride/profiles';
import {
  formatDistance,
  formatDuration,
  getRoutes,
  hasRoutingKey,
  searchPlaces,
  type LatLng,
  type Place,
  type Route,
} from '../stride/routing';

// Used when the device can't give us a GPS fix (common on emulators): downtown DC.
const FALLBACK_LOCATION: LatLng = { latitude: 38.9072, longitude: -77.0369 };

// Free vector tiles, no API key. Falls back to demotiles only if this is unreachable.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// MapLibre wants [longitude, latitude]; the rest of our code uses latitude/longitude.
function toLngLat(c: LatLng): [number, number] {
  return [c.longitude, c.latitude];
}

function routeFeature(coords: LatLng[]): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: coords.map(toLngLat),
    },
  };
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);

  const [me, setMe] = useState<LatLng | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [dest, setDest] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Find the user
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasPermission(status === 'granted');
      if (status !== 'granted') {
        setLocNote('Location is off. Starting from Washington DC. Turn it on in Settings.');
        setMe(FALLBACK_LOCATION);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setMe({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {
        setLocNote('No GPS fix yet. Starting from Washington DC.');
        setMe(FALLBACK_LOCATION);
      }
    })();
  }, []);

  // 2. Get routes whenever the destination changes
  useEffect(() => {
    if (!me || !dest) return;
    let cancelled = false;
    const from = me;
    const to = dest.coords;

    async function loadRoutes() {
      setLoading(true);
      setError(null);
      try {
        const r = await getRoutes(from, to, PROFILES[1]);
        if (cancelled) return;
        setRoutes(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not get a route.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRoutes();
    return () => {
      cancelled = true;
    };
  }, [me, dest]);

  // 3. Fit the map to the routes
  useEffect(() => {
    if (routes.length === 0) return;
    const all = routes.flatMap((r) => r.coords);
    const lngs = all.map((c) => c.longitude);
    const lats = all.map((c) => c.latitude);
    cameraRef.current?.fitBounds(
      [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      {
        padding: { top: 130, bottom: 240, left: 40, right: 40 },
        duration: 600,
      },
    );
  }, [routes]);

  const runSearch = useCallback(async () => {
    if (!query.trim()) return;
    try {
      setResults(await searchPlaces(query, me));
    } catch {
      setError('Search failed. Check your connection.');
    }
  }, [query, me]);

  const pickPlace = (p: Place) => {
    setDest(p);
    setResults([]);
    setQuery(p.label);
  };

  const onLongPress = (e: NativeSyntheticEvent<MapPressEvent>) => {
    pickPlace({
      label: 'Dropped pin',
      coords: { latitude: e.nativeEvent.lngLat[1], longitude: e.nativeEvent.lngLat[0] },
    });
  };

  const clear = () => {
    setDest(null);
    setRoutes([]);
    setQuery('');
    setResults([]);
    setError(null);
  };

  if (!me) {
    return (
      <View style={[styles.center, { backgroundColor: colors.paper }]}>
        <ActivityIndicator color={colors.green} />
        <Text style={[styles.noteText, { marginTop: 12 }]}>Finding your location</Text>
      </View>
    );
  }

  const demo = routes.some((r) => r.demo);

  return (
    <View style={styles.fill}>
      <Map
        ref={mapRef}
        style={styles.fill}
        mapStyle={MAP_STYLE}
        onLongPress={onLongPress}
        attributionPosition={{ top: insets.top + 76, left: 8 }}
        logo={false}
        onDidFailLoadingMap={() => setTilesFailed(true)}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ center: [me.longitude, me.latitude], zoom: 15.5 }}
          minZoom={10}
          maxZoom={20}
        />
        {hasPermission && <UserLocation />}

        {dest && (
          <Marker id="destination" lngLat={toLngLat(dest.coords)}>
            <View style={styles.pin} accessibilityLabel="Destination marker" />
          </Marker>
        )}

        {routes.map((r) => (
          <GeoJSONSource key={r.id} id={`route-${r.id}`} data={routeFeature(r.coords)}>
            <Layer
              type="line"
              id={`route-${r.id}-line`}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': r.id === 'accessible' ? colors.green : colors.standardRoute,
                'line-width': r.id === 'accessible' ? 6 : 4,
                'line-dasharray': r.id === 'accessible' ? [1, 0] : [2, 2],
              }}
            />
          </GeoJSONSource>
        ))}
      </Map>

      {/* Search */}
      <View style={[styles.searchWrap, { top: insets.top + 12 }]}>
        <View style={styles.searchBox}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            placeholder={hasRoutingKey ? 'Where to?' : 'Add a routing key, or long-press the map'}
            placeholderTextColor={colors.inkSoft}
            returnKeyType="search"
            accessibilityLabel="Destination"
          />
          {dest && (
            <Pressable onPress={clear} style={styles.clear} accessibilityLabel="Clear destination">
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          )}
        </View>

        {results.length > 0 &&
          results.map((p, i) => (
            <Pressable
              key={`${p.label}-${i}`}
              style={styles.resultRow}
              onPress={() => pickPlace(p)}
              accessibilityRole="button"
            >
              <Text style={styles.body} numberOfLines={2}>
                {p.label}
              </Text>
            </Pressable>
          ))}

        {locNote && (
          <View style={styles.noteBanner}>
            <Text style={styles.noteText}>{locNote}</Text>
          </View>
        )}

        {tilesFailed && (
          <View style={styles.errorBanner}>
            <Text style={[styles.noteText, { color: colors.amber }]}>
              Map tiles failed to load. Check the connection.
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Text style={[styles.noteText, { color: colors.amber }]}>{error}</Text>
          </View>
        )}
      </View>

      {/* Route summary */}
      {routes.length > 0 && (
        <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}>
          {routes.map((r) => (
            <View key={r.id} style={styles.routeRow}>
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: r.id === 'accessible' ? colors.green : colors.standardRoute },
                ]}
                accessibilityLabel={`${r.label} route`}
              />
              <Text style={styles.body}>
                {r.label} · {formatDistance(r.distanceM)} · {formatDuration(r.durationS)}
              </Text>
            </View>
          ))}
          {demo && (
            <Text style={[styles.noteText, { color: colors.amber, marginTop: 8 }]}>
              Demo routes. Add EXPO_PUBLIC_ORS_KEY to .env for real ones.
            </Text>
          )}
        </View>
      )}

      {loading && <ActivityIndicator style={styles.activity} color={colors.green} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  body: { fontSize: 16, color: colors.ink },
  noteText: { fontSize: 13, color: colors.inkSoft },

  searchWrap: { position: 'absolute', left: 16, right: 16 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 16,
    minHeight: 52,
  },
  input: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 12 },
  clear: { minHeight: 48, justifyContent: 'center', paddingLeft: 12 },
  clearText: { color: colors.green, fontWeight: '600', fontSize: 15 },
  resultRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.line,
  },

  noteBanner: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.amberSoft,
  },
  errorBanner: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.amberSoft,
  },

  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40 },
  swatch: { width: 6, height: 24, borderRadius: 3 },

  activity: { position: 'absolute', bottom: 24, alignSelf: 'center' },
});
