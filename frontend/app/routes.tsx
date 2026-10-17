import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../stride/colors';
import { useStore } from '../stride/store';
import { hazardLabel } from '../stride/hazards';
import {
  formatDistance,
  formatDuration,
  hazardsNearRoute,
  toLngLat,
  type LatLng,
} from '../stride/routing';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function routeFeature(coords: LatLng[]): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords.map(toLngLat) },
  };
}

export default function RouteComparison() {
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const { routes, destination, selectedRouteId, setSelectedRouteId, hazards } = useStore();
  const [ready, setReady] = useState(false);

  const bounds = useMemo<[number, number, number, number] | null>(() => {
    const all = routes.flatMap((r) => r.coords);
    if (all.length === 0) return null;
    const lngs = all.map((c) => c.longitude);
    const lats = all.map((c) => c.latitude);
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  }, [routes]);

  // Keep the map fitted if the routes were still loading when the screen opened.
  useEffect(() => {
    if (!bounds) return;
    cameraRef.current?.fitBounds(bounds, {
      padding: { paddingTop: 20, paddingBottom: 20, paddingLeft: 24, paddingRight: 24 },
      duration: 300,
    });
  }, [bounds, ready]);

  if (!destination) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>No destination yet</Text>
        <Text style={styles.body}>
          Search a destination or long-press the map, then come back here to compare routes.
        </Text>
        <BackBar />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {bounds && (
        <Map
          ref={mapRef}
          style={styles.map}
          mapStyle={MAP_STYLE}
          onDidFinishLoadingMap={() => setReady(true)}
          logo={false}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              bounds,
              padding: { paddingTop: 24, paddingBottom: 24, paddingLeft: 24, paddingRight: 24 },
            }}
          />
          {routes.map((r) => (
            <GeoJSONSource key={r.id} id={`route-${r.id}`} data={routeFeature(r.coords)}>
              <Layer
                type="line"
                id={`route-${r.id}-line`}
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{
                  'line-color': r.id === 'accessible' ? colors.green : colors.standardRoute,
                  'line-width': 6,
                  'line-dasharray': r.id === 'accessible' ? [1, 0] : [2, 2],
                }}
              />
            </GeoJSONSource>
          ))}
        </Map>
      )}

      {routes.length === 0 && (
        <ActivityIndicator style={styles.loading} color={colors.green} />
      )}

      <ScrollView
        style={styles.cards}
        contentContainerStyle={[styles.cardsInner, { paddingBottom: insets.bottom + 16 }]}
      >
        <Text style={styles.heading} accessibilityRole="header">
          Routes to {destination.label}
        </Text>

        {routes.map((r) => {
          const on = r.id === selectedRouteId;
          const near = hazardsNearRoute(r, hazards);
          return (
            <View key={r.id} style={[styles.card, on && styles.cardOn]}>
              <View style={styles.cardHead}>
                <View style={[styles.swatch, { backgroundColor: r.id === 'accessible' ? colors.green : colors.standardRoute }]} />
                <Text style={styles.cardTitle}>{r.label} route</Text>
                <Text style={styles.cardMeta}>
                  {formatDistance(r.distanceM)} · {formatDuration(r.durationS)}
                </Text>
              </View>

              <Text style={styles.item}>
                Sidewalk info: {r.sidewalkInfo ?? 'Not available yet'}
              </Text>
              <Text style={styles.item}>
                Crossings: {r.crossingInfo ?? 'Not available yet'}
              </Text>
              <Text style={styles.item}>
                Accessibility notes: {r.accessibilityNote ?? 'Not available yet'}
              </Text>
              <Text style={styles.item}>
                {near.length === 0
                  ? 'No reported hazards along this route'
                  : `${near.length} reported hazard${near.length > 1 ? 's' : ''}: ${near
                      .map((id) => {
                        const h = hazards.find((x) => x.id === id);
                        return h ? hazardLabel(h.type) : 'reported';
                      })
                      .join(', ')}`}
              </Text>
              {r.demo && <Text style={[styles.item, styles.demoNote]}>Demo route (no routing key set)</Text>}

              <Pressable
                style={styles.useButton}
                onPress={() => {
                  setSelectedRouteId(r.id);
                  router.back();
                }}
                accessibilityRole="button"
                accessibilityLabel={`Use the ${r.label} route`}
              >
                <Text style={styles.useText}>{on ? 'Using this route' : 'Use this route'}</Text>
              </Pressable>
            </View>
          );
        })}

        <BackBar />
      </ScrollView>
    </View>
  );
}

function BackBar() {
  return (
    <Pressable
      style={styles.backBar}
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back to the map"
    >
      <Text style={styles.backText}>Back to the map</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.paper },
  center: {
    flex: 1,
    backgroundColor: colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  map: { flex: 1 },
  cards: {
    maxHeight: '55%',
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  cardsInner: { padding: 16 },
  loading: { position: 'absolute', alignSelf: 'center', top: 16 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  body: { fontSize: 15, color: colors.inkSoft, textAlign: 'center' },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    padding: 14,
    marginBottom: 12,
  },
  cardOn: { borderColor: colors.green, borderWidth: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  swatch: { width: 6, height: 26, borderRadius: 3 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  cardMeta: { fontSize: 14, color: colors.inkSoft, marginLeft: 'auto' },
  item: { fontSize: 14, color: colors.ink, marginTop: 6 },
  demoNote: { color: colors.amber },
  useButton: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  useText: { color: colors.green, fontWeight: '600', fontSize: 15 },
  backBar: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.green, fontWeight: '600', fontSize: 15 },
});
