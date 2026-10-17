import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, type LongPressEvent } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../stride/colors';
import { PROFILES, type Profile } from '../stride/profiles';
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [me, setMe] = useState<LatLng | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(PROFILES[1]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [dest, setDest] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState<Route['id']>('accessible');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 1. Find the user
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Location is off. Turn it on in settings so Stride can start routes from where you are.');
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({});
        setMe({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {
        setMe(FALLBACK_LOCATION);
      }
    })();
  }, []);

  // 2. Get routes whenever the destination or profile changes
  useEffect(() => {
    if (!me || !dest) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRoutes(me, dest.coords, profile)
      .then((r) => {
        if (cancelled) return;
        setRoutes(r);
        setSelected(r.find((x) => x.id === 'accessible') ? 'accessible' : 'standard');
        const all = r.flatMap((x) => x.coords);
        mapRef.current?.fitToCoordinates(all, {
          edgePadding: { top: 160, right: 40, bottom: 380, left: 40 },
          animated: true,
        });
      })
      .catch((e) => !cancelled && setError(e.message ?? 'Could not get a route.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [me, dest, profile]);

  const runSearch = useCallback(async () => {
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

  const onLongPress = (e: LongPressEvent) => {
    pickPlace({ label: 'Dropped pin', coords: e.nativeEvent.coordinate });
    setQuery('');
  };

  const clear = () => {
    setDest(null);
    setRoutes([]);
    setQuery('');
    setResults([]);
    setError(null);
  };

  if (locError) {
    return (
      <View style={[styles.center, { backgroundColor: colors.paper }]}>
        <Text style={styles.title}>Stride</Text>
        <Text style={[styles.body, { textAlign: 'center', marginTop: 8 }]}>{locError}</Text>
      </View>
    );
  }

  if (!me) {
    return (
      <View style={[styles.center, { backgroundColor: colors.paper }]}>
        <ActivityIndicator color={colors.green} />
        <Text style={[styles.body, { marginTop: 12 }]}>Finding your location</Text>
      </View>
    );
  }

  const ordered = [...routes].sort((a, b) => (a.id === selected ? 1 : b.id === selected ? -1 : 0));
  const demo = routes.some((r) => r.demo);

  return (
    <View style={styles.fill}>
      <MapView
        ref={mapRef}
        style={styles.fill}
        initialRegion={{ ...me, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
        showsUserLocation
        showsMyLocationButton={false}
        onLongPress={onLongPress}
      >
        {dest && <Marker coordinate={dest.coords} title={dest.label} />}
        {ordered.map((r) => (
          <Polyline
            key={r.id}
            coordinates={r.coords}
            strokeWidth={r.id === selected ? 7 : 4}
            strokeColor={r.id === 'accessible' ? colors.green : colors.standardRoute}
            lineDashPattern={r.id === selected ? undefined : [8, 8]}
          />
        ))}
      </MapView>

      {/* Search */}
      <View style={[styles.searchWrap, { top: insets.top + 12 }]}>
        <View style={styles.searchBox}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            placeholder={hasRoutingKey ? 'Where to?' : 'Long-press the map to set a destination'}
            placeholderTextColor={colors.inkSoft}
            returnKeyType="search"
            editable={hasRoutingKey}
            accessibilityLabel="Destination"
          />
          {dest && (
            <Pressable onPress={clear} style={styles.clear} accessibilityLabel="Clear destination">
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          )}
        </View>
        {results.length > 0 && (
          <View style={styles.results}>
            {results.map((p, i) => (
              <Pressable
                key={`${p.label}-${i}`}
                style={[styles.resultRow, i > 0 && styles.resultDivider]}
                onPress={() => pickPlace(p)}
              >
                <Text style={styles.body} numberOfLines={2}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* Bottom panel */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={styles.label}>I'm getting around by</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {PROFILES.map((p) => {
            const on = p.id === profile.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setProfile(p)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={[styles.note, { marginTop: 8 }]}>{profile.note}</Text>

        {!dest && !loading && (
          <Text style={[styles.body, { marginTop: 16 }]}>
            Pick a destination to compare routes.
          </Text>
        )}

        {loading && <ActivityIndicator style={{ marginTop: 16 }} color={colors.green} />}

        {error && <Text style={[styles.error, { marginTop: 12 }]}>{error}</Text>}

        {!loading &&
          routes.map((r) => {
            const on = r.id === selected;
            const isAccessible = r.id === 'accessible';
            return (
              <Pressable
                key={r.id}
                onPress={() => setSelected(r.id)}
                style={[styles.routeCard, on && styles.routeCardOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: isAccessible ? colors.green : colors.standardRoute },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeTitle}>{r.label} route</Text>
                  <Text style={styles.note}>
                    {formatDistance(r.distanceM)} · {formatDuration(r.durationS)}
                  </Text>
                </View>
              </Pressable>
            );
          })}

        {demo && !loading && (
          <View style={styles.demoBanner}>
            <Text style={styles.demoText}>
              Demo routes. Add EXPO_PUBLIC_ORS_KEY to .env for real ones.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink },
  body: { fontSize: 16, color: colors.ink },
  note: { fontSize: 14, color: colors.inkSoft },
  error: { fontSize: 14, color: colors.amber },
  label: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginBottom: 8 },

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
  results: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: 6,
  },
  resultRow: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 48, justifyContent: 'center' },
  resultDivider: { borderTopWidth: 1, borderTopColor: colors.line },

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
  chips: { gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { fontSize: 15, color: colors.ink, fontWeight: '500' },
  chipTextOn: { color: '#FFFFFF' },

  routeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    padding: 14,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  routeCardOn: { borderColor: colors.green, borderWidth: 2 },
  swatch: { width: 6, height: 36, borderRadius: 3 },
  routeTitle: { fontSize: 16, fontWeight: '600', color: colors.ink },

  demoBanner: {
    marginTop: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.amberSoft,
  },
  demoText: { fontSize: 13, color: colors.amber },
});