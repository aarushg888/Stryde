import { useEffect, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Camera, Map, Marker, type PressEvent as MapPressEvent } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../stride/colors';
import { HAZARD_TYPES, hazardLabel } from '../stride/hazards';
import { useStore } from '../stride/store';
import { toLngLat, type LatLng } from '../stride/routing';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const { reportHazard } = useStore();
  const [type, setType] = useState<string>(HAZARD_TYPES[0].id);
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [txType, setTxType] = useState<'plain' | 'plain2'>('plain');
  const [picking, setPicking] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocNote('Location is off. Tap the map to choose where it is.');
        setCoords({ latitude: 38.9072, longitude: -77.0369 });
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {
        setLocNote('No GPS fix yet. Tap the map to choose where it is.');
        setCoords({ latitude: 38.9072, longitude: -77.0369 });
      }
    })();
  }, []);

  const canSubmit = !!type && !!coords && !busy;

  const submit = async () => {
    if (!canSubmit || !coords) return;
    setBusy(true);
    try {
      await reportHazard({
        type: type as keyof typeof HAZARD_TYPES[number] as any,
        note: note.trim() || null,
        coords,
        photoUri: null,
      });
      router.replace('/reported');
    } catch {
      Alert.alert('Could not save the report. Try again.');
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 16 }]}
    >
      <Pressable
        style={styles.back}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back to the map"
      >
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text style={styles.heading} accessibilityRole="header">
        Report a hazard
      </Text>

      <View style={styles.list}>
        {HAZARD_TYPES.map((t) => {
          const on = t.id === type;
          return (
            <Pressable
              key={t.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => setType(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Report ${t.label}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Location</Text>
        {locNote && <Text style={styles.rowNote}>{locNote}</Text>}
        {coords && (
          <View style={styles.miniCard}>
            <Map
              style={styles.map}
              mapStyle={MAP_STYLE}
              onPress={(e: NativeSyntheticEvent<MapPressEvent>) => {
                const lng = e.nativeEvent.lngLat[0];
                const lat = e.nativeEvent.lngLat[1];
                setCoords({ latitude: lat, longitude: lng });
              }}
              logo={false}
            >
              <Camera initialViewState={{ center: toLngLat(coords), zoom: 15.5 }} />
              <Marker id="report-pin" lngLat={toLngLat(coords)}>
                <View style={styles.pin} accessibilityLabel="Pinned location" />
              </Marker>
            </Map>
            <Text style={styles.mapHint}>
              Tap the map to change it. Currently around{' '}
              {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.label}>Photos</Text>
      <Text style={styles.note}>
        Not available yet. Photos need a native rebuild (expo-image-picker); text reports work now.
      </Text>

      <Text style={styles.label}>Add a note (optional)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Anything the team should know"
        placeholderTextColor={colors.inkSoft}
        multiline
        maxLength={280}
        accessibilityLabel="Hazard notes"
      />

      <Pressable
        style={[styles.submit, !canSubmit && styles.submitOff]}
        onPress={submit}
        accessibilityRole="button"
        accessibilityLabel="Submit the hazard report"
        accessibilityState={{ disabled: !canSubmit }}
      >
        <Text style={styles.submitText}>Submit report</Text>
      </Pressable>
      <Text style={styles.note}>
        {locNote !== null ? '' : ''}
        {busy ? 'Saving...' : ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.paper },
  inner: { padding: 16, gap: 12 },
  back: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center' },
  backText: { color: colors.green, fontWeight: '600', fontSize: 16 },
  heading: { fontSize: 24, fontWeight: '700', color: colors.ink },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.green, borderColor: colors.green },
  chipText: { fontSize: 15, color: colors.ink },
  chipTextOn: { color: '#FFFFFF', fontWeight: '600' },
  row: { gap: 8 },
  rowLabel: { fontSize: 15, color: colors.ink, fontWeight: '500' },
  rowNote: { fontSize: 13, color: colors.amber },
  miniCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  map: { height: 220, width: '100%' },
  mapHint: { fontSize: 12, color: colors.inkSoft, padding: 8 },
  pin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.amber,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  label: { fontSize: 15, color: colors.ink, fontWeight: '500' },
  note: { fontSize: 13, color: colors.inkSoft },
  input: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  submit: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitOff: { opacity: 0.4 },
  submitText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});
