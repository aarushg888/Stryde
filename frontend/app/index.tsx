import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../stride/colors';
import { PROFILES } from '../stride/profiles';
import { hazardLabel } from '../stride/hazards';
import { hasApi, hasRoutingKey } from '../stride/routing';
import { hasRoutingKey as orsKeySet, hasApi as apiSet } from '../stride/env'; // placeholder swapped below
import { useStore } from '../stride/store';
import {
  formatDistance,
  formatDuration,
  getRoutes,
  searchPlaces,
  toLngLat,
} from '../stride/routing';

// Used when the device can't give us a GPS fix (common on emulators): downtown DC.
const FALLBACK_LOCATION = { latitude: 38.9072, longitude: -77.0369 };

// Free vector tiles, no API key.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function routeFeature(coords) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords.map(toLngLat) },
  };
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);
  const store = useStore();

  const { origin, destination, routes, hazards, preferences } = store;
  const profile = PROFILES.find((p) => p.id === preferences.profileId) ?? PROFILES[0];

  const [me, setMe] = useState(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Find the user (permission + GPS or a DC fallback)
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasPermission(status === 'granted');
      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setMe({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        } catch {
          setMe(FALLBACK_LOCATION);
        }
      } else {
        setLocNote('Location is off. Starting from Washington DC. Turn it on in Settings.');
        setMe(FALLBACK_LOCATION);
      }
    })();
  }, []);

  // 2. Default the start to where you are
  useEffect(() => {
    if (me && !origin) store.setOrigin({ label: 'Current location', coords: me });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // 3. Load reported hazards from the backend when there is one
  useEffect(() => {
    if (hasApi) store.loadHazards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4. Routes whenever start, destination or preferred travel style changes
  useEffect(() => {
    if (!origin || !destination) return;
    let cancelled = false;
    const from = origin.coords;
    const to = destination.coords;

    async function loadRoutes() {
      setLoading(true);
      setError(null);
      try {
        const r = await getRoutes(from, to, profile, {
          maxInclinePct: preferences.maxInclinePct,
          maxKerbM: preferences.maxKerbM,
          pavedOnly: preferences.pavedOnly,
        });
        if (cancelled) return;
        store.setRoutes(r);
        if (!store.selectedRouteId) store.setSelectedRouteId(r[0].id);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, preferences.profileId, preferences.maxInclinePct, preferences.maxKerbM, preferences.pavedOnly]);

  // 5. Fit the map to the routes
  useEffect(() => {
    if (routes.length === 0) return;
    const all = routes.flatMap((r) => r.coords);
    const lngs = all.map((c) => c.longitude);
    const lats = all.map((c) => c.latitude);
    cameraRef.current?.fitBounds(
      [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
      {
        padding: { paddingTop: 130, paddingBottom: 240, paddingLeft: 40, paddingRight: 40 },
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

  const pickPlace = (p) => {
    store.setDestination(p);
    setResults([]);
    setQuery(p.label);
  };

  const onLongPress = (e) => {
    pickPlace({
      label: 'Dropped pin',
      coords: { latitude: e.nativeEvent.lngLat[1], longitude: e.nativeEvent.lngLat[0] },
    });
  };

  const clear = () => {
    store.setDestination(null);
    store.setRoutes([]);
    setQuery('');
    setResults([]);
    setError(null);
  };

  const useCurrent = () => {
    if (!me) return;
    store.setOrigin({ label: 'Current location', coords: me });
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

        {/* Destination pin */}
        {destination && (
          <Marker id="destination" lngLat={toLngLat(destination.coords)}>
            <View style={styles.pin} accessibilityLabel="Destination marker" />
          </Marker>
        )}

        {/* Reported hazards */}
        {hazards.map((h) => (
          <Marker key={h.id} id={h.id} lngLat={toLngLat(h.coords)}>
            <View style={styles.hazardDot} accessibilityLabel={`Reported hazard: ${hazardLabel(h.type)}`} />
          </Marker>
        ))}

        {routes.map((r) => (
          <GeoJSONSource key={r.id} id={`route-${r.id}`} data={routeFeature(r.coords)}>
            <Layer
              type="line"
              id={`route-${r.id}-line`}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color':
                  r.id === (store.selectedRouteId ?? 'accessible')
                    ? colors.green
                    : colors.standardRoute,
                'line-width': 5,
                'line-dasharray': r.id === 'accessible' ? [1, 0] : [2, 2],
              }}
            />
          </GeoJSONSource>
        ))}
      </Map>

      {/* Search + start */}
      <View style={[styles.searchWrap, { top: insets.top + 12 }]}>
        <View style={styles.searchBox}>
          <Pressable
            onPress={useCurrent}
            accessibilityRole="button"
            accessibilityLabel="Use my current location as the start"
          >
            <View style={styles.start}>
              <Text style={styles.startLabel}>From</Text>
              <Text style={styles.startValue} numberOfLines={1}>
                {origin?.label ?? 'Current location'}
              </Text>
            </View>
          </Pressable>
          <View style={styles.divider} />
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
          {destination && (
            <Pressable onPress={clear} style={styles.clear} accessibilityLabel="Clear destination">
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          )}
        </View>

        {results.map((p, i) => (
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
          <View style={styles.noteBanner}>
            <Text style={[styles.noteText, { color: colors.amber }]}>
              Map tiles failed to load. Check the connection.
            </Text>
          </View>
        )}
        {error && (
          <View style={styles.noteBanner}>
            <Text style={[styles.noteText, { color: colors.amber }]}>{error}</Text>
          </View>
        )}
      </View>

      {/* Bottom panel */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          style={styles.routeButton}
          onPress={() => router.push('/routes')}
          accessibilityRole="button"
          accessibilityLabel="Find a safer route"
        >
          <Text style={styles.routeButtonText}>
            {destination ? 'Find a safer route' : 'Search a destination to compare routes'}
          </Text>
        </Pressable>

        {routes.length > 0 && !loading && (
          <View style={styles.summary}>
            {routes.map((r) => (
              <View key={r.id} style={styles.summaryRow}>
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: r.id === 'accessible' ? colors.green : colors.standardRoute },
                  ]}
                />
                <Text style={styles.body}>
                  {r.label} · {formatDistance(r.distanceM)} · {formatDuration(r.durationS)}
                </Text>
              </View>
            ))}
            {demo && (
              <Text style={[styles.noteText, { color: colors.amber, marginTop: 6 }]}>
                Demo routes. Add EXPO_PUBLIC_ORS_KEY to .env for real ones.
              </Text>
            )}
          </View>
        )}

        <View style={styles.links}>
          <Pressable
            style={styles.link}
            onPress={() => router.push('/preferences')}
            accessibilityRole="button"
            accessibilityLabel="Walking preferences"
          >
            <Text style={styles.linkText}>Preferences</Text>
          </Pressable>
          <Pressable
            style={styles.link}
            onPress={() => router.push('/report')}
            accessibilityRole="button"
            accessibilityLabel="Report a hazard"
          >
            <Text style={styles.linkText}>Report hazard</Text>
          </Pressable>
        </View>
      </View>

      {loading && <ActivityIndicator style={styles.activity} color={colors.green} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  body: { fontSize: 15, color: colors.ink },
  noteText: { fontSize: 13, color: colors.inkSoft },

  searchWrap: { position: 'absolute', left: 16, right: 16 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 12,
    minHeight: 56,
    gap: 8,
  },
  start: { justifyContent: 'center', minHeight: 48 },
  startLabel: { fontSize: 10, color: colors.inkSoft, textTransform: 'uppercase' },
  startValue: { fontSize: 14, color: colors.ink, fontWeight: '500' },
  divider: { width: 1, height: 26, backgroundColor: colors.line },
  input: { flex: 1, fontSize: 16, color: colors.ink, paddingVertical: 12, minWidth: 80 },
  clear: { minHeight: 48, justifyContent: 'center', paddingLeft: 8 },
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
    minHeight: 48,
  },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  hazardDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.amber,
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
    gap: 10,
  },
  routeButton: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  routeButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  summary: { gap: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  swatch: { width: 6, height: 20, borderRadius: 3 },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { minHeight: 48, justifyContent: 'center', paddingRight: 16 },
  linkText: { color: colors.green, fontWeight: '600', fontSize: 15 },
  activity: { position: 'absolute', bottom: 24, alignSelf: 'center' },
});
