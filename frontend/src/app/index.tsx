import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import { HintRow } from '@/components/hint-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
// Import the native map components
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
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.heroSection}>
          <ThemedText type="title" style={styles.title}>
            Welcome to&nbsp;Stryde
          </ThemedText>
        </ThemedView>

        {/* Completely native map rendering - bypasses WebView & CDN blocks entirely */}
        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: 40.7128,
              longitude: -74.0060,
              latitudeDelta: 0.0922,
              longitudeDelta: 0.0421,
            }}
          >
            <Marker 
              coordinate={{ latitude: 40.7128, longitude: -74.0060 }}
              title="Stryde Location"
            />
          </MapView>
        </View>

        <ThemedText type="code" style={styles.code}>
          get started
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
  title: { textAlign: 'center', fontSize: 32, lineHeight: 36, fontWeight: '700' },
  mapContainer: { 
    width: '100%', 
    height: 250, 
    borderRadius: Spacing.four, 
    overflow: 'hidden',
    backgroundColor: '#e5e3df' 
  },
  map: { 
    width: '100%',
    height: '100%' 
  },
  code: { textTransform: 'uppercase', textAlign: 'center' },
  stepContainer: { gap: Spacing.three, alignSelf: 'stretch', paddingHorizontal: Spacing.three, paddingVertical: Spacing.four, borderRadius: Spacing.four },
});
