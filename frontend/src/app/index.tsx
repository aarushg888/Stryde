import React, { useEffect, useState } from 'react';
import {
  Platform, StyleSheet, TextInput, TouchableOpacity, View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Colors } from '@/constants/theme';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { api, BASE_URL, type RouteResult } from '@/api/api';

// MVP coverage area kept in sync with the backend's built graph (Logan Circle).
const DC_REGION = {
  latitude: 38.9137, longitude: -77.0325,
  latitudeDelta: 0.012, longitudeDelta: 0.012,
};
const DEMO_START = '38.9131,-77.0305';
const DEMO_GOAL = '38.9184,-77.0248';

const WALK_SPEED_KMH = 4.5;

export default function HomeScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  const [startLocation, setStartLocation] = useState('');
  const [destination, setDestination] = useState('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [svcState, setSvcState] = useState<'checking' | 'online' | 'warming' | 'offline'>('checking');
  const mapRef = React.useRef<MapView>(null);

  // Backend visibility pill: tells users whether the API is reachable before they type.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        setSvcState(h.ok ? (h.weights ? 'online' : 'warming') : 'offline');
      } catch {
        if (alive) setSvcState('offline');
      }
    };
    void poll();
    const id = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const loadDemo = () => {
    setStartLocation(DEMO_START);
    setDestination(DEMO_GOAL);
  };

  const swapEnds = () => {
    setStartLocation(destination);
    setDestination(startLocation);
    setRoute(null);
    setRouteError(null);
  };

  const handleFindRoute = async () => {
    if (!startLocation.trim() || !destination.trim()) {
      setRouteStatus('Enter a start and a destination to plan a route.');
      return;
    }
    setFinding(true);
    setRoute(null);
    setRouteError(null);
    setRouteStatus('Finding the safest route…');
    try {
      const result = await api.searchRoute(startLocation.trim(), destination.trim());
      setRoute(result);
      const km = (result.total_cut_m / 1000).toFixed(2);
      const mins = Math.max(1, Math.round((result.total_cut_m / 1000) / WALK_SPEED_KMH * 60));
      const detour = result.straight_m && result.ratio ? ` · ${result.ratio}× straight line` : '';
      setRouteStatus(`${km} km · about ${mins} min${detour} · ${result.path.length} segments`);
      if (result.geometry.length > 1) {
        mapRef.current?.fitToCoordinates(
          result.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
          { edgePadding: { top: 80, right: 60, bottom: 80, left: 60 }, animated: true });
      }
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : 'Route failed');
    } finally {
      setFinding(false);
    }
  };

  const routeCoords = route?.geometry?.length
    ? route.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))
    : [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Stryde</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
            Accessible pedestrian routing
          </ThemedText>
        </View>

        <View style={[styles.mapCard, { borderColor: colors.backgroundElement }]}>
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={DC_REGION}
            showsUserLocation={false}
            showsMyLocationButton={false}
            toolbarEnabled={false}
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
                  strokeColor={scheme === 'dark' ? '#2ecc71' : '#27ae60'}
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
          </MapView>
        </View>

        {/* Route planner panel scrolls independently of the map */}
        <View style={{ flex: 1 }} accessibilityLabel="Route planner">
          <View style={styles.plannerCard}>
            <View style={styles.plannerHeaderRow}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.plannerLabel}>
                Plan a route
              </ThemedText>
              {svcState !== 'online' && (
                <View
                  accessibilityLabel={`Backend status: ${svcState}`}
                  style={[
                    styles.svcPill,
                    svcState === 'offline' && { backgroundColor: 'rgba(231,76,60,0.12)' },
                    svcState === 'warming' && { backgroundColor: 'rgba(241,196,15,0.15)' },
                  ]}
                >
                  <View
                    style={[
                      styles.svcDot,
                      svcState === 'offline' && { backgroundColor: '#e74c3c' },
                      svcState === 'warming' && { backgroundColor: '#f1c40f' },
                      svcState === 'checking' && { backgroundColor: '#888' },
                    ]}
                  />
                  <ThemedText
                    style={[
                      styles.svcPillText,
                      svcState === 'offline' && { color: '#e74c3c' },
                      svcState === 'warming' && { color: '#b7950b' },
                    ]}
                  >
                    {svcState === 'warming' ? 'Detector warming up' : svcState === 'offline' ? 'Backend offline' : 'Checking…'}
                  </ThemedText>
                </View>
              )}
              <TouchableOpacity
                style={styles.textChip}
                onPress={loadDemo}
                accessibilityRole="button"
                accessibilityLabel="Use demo locations"
              >
                <ThemedText style={styles.textChipText}>Demo route</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Start point */}
            <View style={styles.fieldRow}>
              <View style={[styles.iconBadge, { backgroundColor: 'rgba(46, 204, 113, 0.12)' }]}>
                <MaterialIcons name="my-location" size={16} color="#2ecc71" />
              </View>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.backgroundElement }]}
                placeholder="Starting point (GPS, node id, or lat,lng)"
                placeholderTextColor="#888"
                value={startLocation}
                onChangeText={setStartLocation}
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
                  onPress={() => setStartLocation('')}
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
              <MaterialIcons name="swap-vert" size={18} color="#3498db" />
            </TouchableOpacity>

            {/* Destination */}
            <View style={styles.fieldRow}>
              <View style={[styles.iconBadge, { backgroundColor: 'rgba(231, 76, 60, 0.12)' }]}>
                <MaterialIcons name="flag" size={16} color="#e74c3c" />
              </View>
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.backgroundElement }]}
                placeholder="Destination (node id, or lat,lng)"
                placeholderTextColor="#888"
                value={destination}
                onChangeText={setDestination}
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
                  onPress={() => setDestination('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear destination"
                >
                  <MaterialIcons name="close" size={16} color="#888" />
                </TouchableOpacity>
              )}
            </View>

            {/* Find route CTA */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleFindRoute}
              disabled={finding}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Find the safest pedestrian route"
            >
              <MaterialIcons name="verified-user" size={18} color="#ffffff" />
              <ThemedText style={styles.actionButtonText}>
                {finding ? 'Routing…' : 'Find safer route'}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Result / error banner */}
          {(routeError || routeStatus) && (
            <ThemedView
              type="backgroundElement"
              style={[styles.statusCard, routeError ? styles.statusCardError : null]}
            >
              <MaterialIcons
                name={routeError ? 'error-outline' : 'route'}
                size={18}
                color={routeError ? '#e74c3c' : '#2ecc71'}
              />
              <ThemedText style={[styles.statusText, { color: colors.text }]} adjustsFontSizeToFit={false}>
                {routeError ?? routeStatus}
              </ThemedText>
            </ThemedView>
          )}

          {/* Route summary when a path exists */}
          {route && !routeError && (
            <ThemedView type="backgroundElement" style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryDot} />
                <ThemedText numberOfLines={1} style={styles.summaryText}>
                  {route.start_node}
                </ThemedText>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowLast]}>
                <View style={[styles.summaryDot, styles.summaryDotGoal]} />
                <ThemedText numberOfLines={1} style={styles.summaryText}>
                  {route.goal_node}
                </ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary" style={styles.summaryMeta}>
                Snap: {route.snap.start_m} m start, {route.snap.goal_m} m end · network
                distance {route.cost} m · {route.graph.nodes} graph nodes
              </ThemedText>
            </ThemedView>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>
            API target: {BASE_URL} — backend must run on port 8100 (README: /search, /detect, /coverage).
          </ThemedText>

          {Platform.OS === 'web' && <WebBadge />}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    paddingTop: Spacing.one,
    paddingBottom: Spacing.one,
  },
  title: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  mapCard: {
    height: 250,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    borderWidth: 1,
  },
  map: { width: '100%', height: '100%' },
  plannerCard: {
    gap: Spacing.two,
    backgroundColor: 'rgba(126, 123, 123, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(126, 123, 123, 0.12)',
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  plannerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  plannerLabel: {
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  svcPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(149,165,166,0.15)',
  },
  svcDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2ecc71' },
  svcPillText: { fontSize: 11 },
  textChip: {
    borderWidth: 1,
    borderColor: 'rgba(52, 152, 219, 0.4)',
    backgroundColor: 'rgba(52, 152, 219, 0.1)',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 36,
    justifyContent: 'center',
  },
  textChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3498db',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 48,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    fontSize: 15,
    backgroundColor: 'transparent',
  },
  clearButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Spacing.four,
  },
  swapButton: {
    alignSelf: 'center',
    width: 36,
    height: 36,
    marginTop: -Spacing.three,
    marginBottom: -Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: 'rgba(52, 152, 219, 0.4)',
    backgroundColor: 'rgba(52, 152, 219, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  actionButton: {
    width: '100%',
    height: 48,
    backgroundColor: '#2ecc71',
    borderRadius: Spacing.three,
    flexDirection: 'row',
    gap: Spacing.one,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  statusCard: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  statusCardError: {
    borderWidth: 1,
    borderColor: 'rgba(231, 76, 60, 0.35)',
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontWeight: '500',
  },
  summaryCard: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  summaryRowLast: {
    paddingBottom: Spacing.one,
  },
  summaryDot: {
    width: 10,
    height: 10,
    borderRadius: Spacing.four,
    backgroundColor: '#2ecc71',
  },
  summaryDotGoal: { backgroundColor: '#e74c3c' },
  summaryText: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  summaryMeta: {
    lineHeight: 18,
  },
  helper: {
    textAlign: 'center',
    opacity: 0.65,
    paddingBottom: BottomTabInset + Spacing.three,
    paddingHorizontal: Spacing.two,
  },
});
