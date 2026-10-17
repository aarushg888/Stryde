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
import MapView, { Marker } from 'react-native-maps';

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

  const handleUseCurrentLocation = () => {
    setStartLocation('My Current Location');
  };

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
            style={styles.map}
            initialRegion={{
              latitude: 40.7128,
              longitude: -74.0060,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            {/* Base user location pin */}
            <Marker 
              coordinate={{ latitude: 40.7128, longitude: -74.0060 }}
              title="Your Location"
              pinColor="#3498db"
            />

            {/* Pedestrian-relevant Details: Blocked Sidewalk Hazard Pin */}
            <Marker 
              coordinate={{ latitude: 40.7158, longitude: -74.0020 }}
              title="Blocked Sidewalk"
              description="Construction blocking accessible ramp framework."
              pinColor="#e74c3c"
            />

            {/* Pedestrian-relevant Details: Fallen Tree Hazard Pin */}
            <Marker 
              coordinate={{ latitude: 40.7085, longitude: -74.0110 }}
              title="Fallen Tree"
              description="Large branches completely blocking pedestrian walkway paths."
              pinColor="#e74c3c"
            />
          </MapView>
        </View>

        {/* Interactive Search Controls Section (Cleanly stacked under map container position) */}
        <View style={styles.routingContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={[styles.inputField, { color: colors.text, borderColor: colors.backgroundElement }]}
              placeholder="Starting Location..."
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
            placeholder="Enter Destination..."
            placeholderTextColor="#888"
            value={destination}
            onChangeText={setDestination}
          />

          <TouchableOpacity style={styles.actionRouteButton} activeOpacity={0.8}>
            <ThemedText style={styles.actionButtonText}>🛡️ Find a Safer Route</ThemedText>
          </TouchableOpacity>
        </View>

        <ThemedText type="code" style={styles.code}>
          Enter Your Destination and Explore the World with Stryde!
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.stepContainer}>
          <HintRow title="Try editing" hint Papaya={<ThemedText type="code">src/app/index.tsx</ThemedText>} />
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
