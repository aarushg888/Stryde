import React, { useState } from 'react';
import { Platform, StyleSheet, View, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import { HintRow } from '@/components/hint-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing, Colors } from '@/constants/theme';
import { useColorScheme } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { api, type RouteResult } from '@/api/api';

// MVP coverage area kept in sync with the backend's built graph (Logan Circle).
const DC_REGION = {
  latitude: 38.9137, longitude: -77.0325,
  latitudeDelta: 0.012, longitudeDelta: 0.012,
};

function getDevMenuHint() {
  if (Platform.OS === 'web') return <ThemedText type="small">use browser devtools</ThemedText>;
  if (Device.isDevice) {
    return <ThemedText type="small">shake device or press <ThemedText type="code">m</ThemedText> in terminal</ThemedText>;
  }
  const shortcut = Platform.OS === 'android' ? 'cmd+m (or ctrl+m)' : 'cmd+d';
  return <ThemedText type="small">press <ThemedText type="code">{shortcut}</ThemedText></ThemedText>;
}

export default function HomeScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  
  // State variables for the search input inputs
  const [startLocation, setStartLocation] = useState('');
  const [destination, setDestination] = useState('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const mapRef = React.useRef<MapView>(null);

  const handleUseCurrentLocation = () => {
    setStartLocation('38.9131,-77.0305'); // demo-area center; replace with expo-location later
  };

  const handleFindRoute = async () => {
    if (!startLocation.trim() || !destination.trim()) {
      setRouteStatus('Enter a start (node id or lat,lng) and a destination.');
      return;
    }
    setFinding(true);
    setRoute(null);
    setRouteError(null);
    setRouteStatus('Finding safer route…');
    try {
      const result = await api.searchRoute(startLocation.trim(), destination.trim());
      setRoute(result);
      const km = (result.total_cut_m / 1000).toFixed(2);
      setRouteStatus(`${km} km · ${result.path.length} segments · snapped ${result.snap.start_m}m + ${result.snap.goal_m}m`);
      if (result.geometry.length > 1) {
        mapRef.current?.fitToCoordinates(
          result.geometry.map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
          { edgePadding: { top: 60, right: 40, bottom: 60, left: 40 }, animated: true });
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.heroSection}>
          <ThemedText type="title" style={styles.title}>
            Welcome to&nbsp;Stryde
          </ThemedText>
        </View>

        {/* Completely native map rendering - exactly your original sizing and structure */}
        <View style={styles.mapContainer}>
          <MapView
            ref={mapRef}
            provider={undefined}
            showsUserLocation={false}
            style={styles.map}
            initialRegion={DC_REGION}
          >
            {/* Real walking route from the accessibility router graph */}
            {route && routeCoords.length > 1 && (
              <>
                <Polyline coordinates={routeCoords} strokeWidth={4}
                  strokeColor="#2ecc71" lineDashPattern={[1]} />
                <Marker coordinate={routeCoords[0]} title="Start"
                  description={route.start_node} pinColor="#2ecc71" />
                <Marker coordinate={routeCoords[routeCoords.length - 1]} title="Goal"
                  description={route.goal_node} pinColor="#e74c3c" />
              </>
            )}
          </MapView>
        </View>

        {/* Interactive Search Controls Section (Cleanly stacked under map container position) */}
        <View style={styles.routingContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={[styles.inputField, { color: colors.text, borderColor: colors.backgroundElement }]}
              placeholder="Start (node id or lat,lng)…"
              placeholderTextColor="#888"
              value={startLocation}
              onChangeText={setStartLocation}
            />
            <TouchableOpacity 
              style={styles.locationButton} 
              onPress={handleUseCurrentLocation}
              activeOpacity={0.7}
            >
              <ThemedText style={styles.locationButtonText}>📍 Current</ThemedText>
            </TouchableOpacity>
          </View>

          <TextInput
            style={[styles.inputField, { color: colors.text, borderColor: colors.backgroundElement }]}
            placeholder="Destination (node id or lat,lng)…"
            placeholderTextColor="#888"
            value={destination}
            onChangeText={setDestination}
          />

          <TouchableOpacity style={styles.actionRouteButton} activeOpacity={0.8}
            onPress={handleFindRoute} disabled={finding}>
            <ThemedText style={styles.actionButtonText}>
              {finding ? 'Routing…' : '🛡️ Find a Safer Route'}
            </ThemedText>
          </TouchableOpacity>
        </View>

        <ThemedText type="code" style={styles.code}>
          {routeError ?? routeStatus ?? 'start/goal accept a graph node id (n0…) or "lat,lng"'}
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.stepContainer}>
          <HintRow title="If API unreachable" hint={<ThemedText type="code">uvicorn backend.main:app</ThemedText>} />
          <HintRow title="Dev tools" hint={getDevMenuHint()} />
          <HintRow title="Fresh start" hint={<ThemedText type="code">npm run reset-project</ThemedText>} />
        </ThemedView>

        {Platform.OS === 'web' && <WebBadge />}
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
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  heroSection: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.four },
  title: { textAlign: 'center', fontSize: 32, lineHeight: 36, fontWeight: '900', backgroundColor: 'transparent', top:-15},
  mapContainer: {
    top: -160,
    width: 450, 
    height: 670, 
    left: -40,
    borderRadius: Spacing.four, 
    overflow: 'hidden',
    backgroundColor: '#e5e3df',
    zIndex: -1,
  },
  map: { 
    width: '100%',
    height: '100%'
  },
  routingContainer: {
    top: -155,
    width: '100%',
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  inputWrapper: {
    flexDirection: 'row',
    gap: Spacing.two,
    width: '100%',
  },
  inputField: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 14,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  locationButton: {
    height: 40,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(52, 152, 219, 0.1)',
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: 'rgba(52, 152, 219, 0.3)',
  },
  locationButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3498db',
  },
  actionRouteButton: {
    width: '100%',
    height: 44,
    backgroundColor: '#2ecc71',
    borderRadius: Spacing.two,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  code: { textTransform: 'uppercase', textAlign: 'center', fontSize: 12, lineHeight: 16, fontWeight: '700', backgroundColor: 'transparent', top:-150 },
  stepContainer: { gap: Spacing.three, alignSelf: 'stretch', paddingHorizontal: Spacing.three, paddingVertical: Spacing.four, borderRadius: Spacing.four },
});
