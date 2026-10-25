import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants/theme';
import { api, type Detection, type HazardReport } from '@/api/api';

type HazardType = 'Sidewalk' | 'Tree' | 'Construction' | 'Other';

const HAZARD_META: Record<
  HazardType,
  { label: string; icon: keyof typeof MaterialIcons.glyphMap; color: string; hint: string }
> = {
  Sidewalk: { label: 'Blocked sidewalk', icon: 'accessible', color: '#38bdf8', hint: 'wheel, stroller or cane blocked' },
  Tree: { label: 'Fallen tree', icon: 'park', color: '#4ade80', hint: 'branches or trunks on the path' },
  Construction: { label: 'Construction', icon: 'engineering', color: '#fbbf24', hint: 'work zone closing the walkway' },
  Other: { label: 'Other obstacle', icon: 'more-horiz', color: '#a78bfa', hint: 'anything else blocking the way' },
};

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export default function HazardsScreen() {
  // Form state
  const [selectedType, setSelectedType] = useState<HazardType | null>(null);
  const [locationText, setLocationText] = useState('');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [detections, setDetections] = useState<Detection[] | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiChecked, setAiChecked] = useState(false);
  const [ submitting, setSubmitting] = useState(false);
  const [svcState, setSvcState] = useState<'checking' | 'online' | 'warming' | 'offline'>('checking');

  // Community feed
  const [reports, setReports] = useState<HazardReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        setSvcState(h.ok ? (h.weights ? 'online' : 'warming') : 'offline');
      } catch {
        if (alive) setSvcState('offline');
      }
    })();
    return () => { alive = false; };
  }, []);

  const loadReports = async () => {
    try {
      const res = await api.listHazards(20);
      setReports(res.hazards);
    } catch {
      // feed is best-effort
    } finally {
      setReportsLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await api.listHazards(20);
        if (alive) setReports(res.hazards);
      } catch {
        // feed is best-effort
      } finally {
        if (alive) setReportsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handlePhotoAction = async (mode: 'camera' | 'library') => {
    const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
    const libraryPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (mode === 'camera' && !cameraPerm.granted) {
      Alert.alert('Permission needed', 'Allow camera access to take a photo of the hazard.');
      return;
    }
    if (mode === 'library' && !libraryPerm.granted) {
      Alert.alert('Permission needed', 'Allow gallery access to attach a photo.');
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    };

    const res =
      mode === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    if (!res.canceled && res.assets.length > 0) {
      setPhotoUri(res.assets[0].uri);
      setDetections(null);
      setAiChecked(false);
    }
  };

  const runAiCheck = async () => {
    if (!photoUri) return;
    setAnalyzing(true);
    try {
      const detRes = await api.detectHazard(photoUri);
      setDetections(detRes.detections);
      setAiChecked(true);
    } catch {
      Alert.alert('AI check failed', 'Detector is unavailable right now. You can still submit the report.');
      setDetections(null);
      setAiChecked(true);
    } finally {
      setAnalyzing(false);
    }
  };

  const pickGps = async () => {
    try {
      setGpsBusy(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow location access to attach GPS coordinates.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    } catch {
      Alert.alert('Location error', 'Could not read your location. Try again.');
    } finally {
      setGpsBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedType) {
      Alert.alert('Missing info', 'Pick what kind of hazard this is.');
      return;
    }
    if (!locationText.trim() && !coords) {
      Alert.alert('Missing info', 'Add where this is — tap "Use my location" or describe the location.');
      return;
    }

    setSubmitting(true);
    try {
      let confirmed: Detection[] | null = detections;
      if (photoUri && !aiChecked) {
        try {
          const detRes = await api.detectHazard(photoUri);
          confirmed = detRes.detections;
        } catch {
          // detection is best-effort
        }
      }

      const lat = coords?.lat ?? 0.0;
      const lng = coords?.lng ?? 0.0;
      const where = coords
        ? locationText.trim() || 'GPS pin'
        : locationText.trim();
      const formData = new FormData();
      formData.append('type', selectedType);
      formData.append('lat', String(lat));
      formData.append('lng', String(lng));
      formData.append('description', `${where}${description.trim() ? ` — ${description.trim()}` : ''}`);

      if (photoUri) {
        const filename = photoUri.split('/').pop() || 'hazard.jpg';
        // @ts-ignore -- RN FormData file shape
        formData.append('file', { uri: photoUri, name: filename, type: 'image/jpeg' });
      }

      await api.reportHazard(formData);
      setDetections(confirmed);
      setIsSubmitted(true);
      void loadReports();
    } catch (e) {
      Alert.alert('Submission error', e instanceof Error ? e.message : 'Failed to report hazard');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedType(null);
    setLocationText('');
    setDescription('');
    setPhotoUri(null);
    setCoords(null);
    setDetections(null);
    setAiChecked(false);
    setIsSubmitted(false);
  };

  if (isSubmitted) {
    const meta = selectedType ? HAZARD_META[selectedType] : null;
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.confirmWrap}>
          <View style={[styles.successIconWrap, { backgroundColor: 'rgba(74,222,128,0.12)' }]}>
            <MaterialIcons name="check-circle" size={54} color="#4ade80" />
          </View>
          <ThemedText type="title" style={styles.title}>
            Hazard reported
          </ThemedText>
          <ThemedText style={styles.subtitle}>
            Thanks — your report is now visible in the community feed and helps other pedestrians route around it.
          </ThemedText>

          <View style={styles.summaryCard}>
            {selectedType && meta ? (
              <View style={styles.summaryRow}>
                <MaterialIcons name={meta.icon} size={18} color={meta.color} />
                <ThemedText style={styles.summaryText}>{meta.label}</ThemedText>
              </View>
            ) : null}
            <View style={styles.summaryRow}>
              <MaterialIcons name="place" size={18} color="#94a3b8" />
              <ThemedText style={styles.summaryText} numberOfLines={2}>
                {coords
                  ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}${locationText ? ` · ${locationText}` : ''}`
                  : locationText}
              </ThemedText>
            </View>
            {photoUri ? <Image source={{ uri: photoUri }} style={styles.photoPreview} /> : null}
            {detections !== null && (
              <View style={styles.aiChipsRow}>
                {detections.length > 0 ? (
                  Object.entries(
                    detections.reduce<Record<string, number>>((acc, d) => {
                      acc[d.class] = (acc[d.class] ?? 0) + 1;
                      return acc;
                    }, {}),
                  ).map(([k, v]) => (
                    <View key={k} style={styles.aiChip}>
                      <ThemedText style={styles.aiChipText}>
                        {`AI: ${k}×${v}`}
                      </ThemedText>
                    </View>
                  ))
                ) : (
                  <View style={styles.aiChipOk}>
                    <MaterialIcons name="verified" size={14} color="#4ade80" />
                    <ThemedText style={styles.aiChipOkText}>AI: no barriers found</ThemedText>
                  </View>
                )}
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.actionButton} onPress={resetForm} activeOpacity={0.85}>
            <ThemedText style={styles.actionButtonText}>Report another hazard</ThemedText>
          </TouchableOpacity>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>Street hazards</ThemedText>
            <ThemedText style={styles.subtitle}>
              Blocked corners, fallen trees, construction — log it so wheelchair users and strollers can route around it.
            </ThemedText>
            <View
              style={[
                styles.svcPill,
                svcState === 'offline' && { backgroundColor: 'rgba(239,68,68,0.12)' },
                svcState === 'warming' && { backgroundColor: 'rgba(234,179,8,0.14)' },
                svcState === 'online' && { backgroundColor: 'rgba(34,197,94,0.12)' },
              ]}
            >
              <View
                style={[
                  styles.svcDot,
                  svcState === 'offline' && { backgroundColor: '#ef4444' },
                  svcState === 'warming' && { backgroundColor: '#eab308' },
                  svcState === 'online' && { backgroundColor: '#22c55e' },
                ]}
              />
              <ThemedText style={styles.svcPillText}>
                {svcState === 'online'
                  ? 'AI detector online'
                  : svcState === 'warming'
                    ? 'Detector warming up'
                    : svcState === 'offline'
                      ? 'Detector offline — reports still work'
                      : 'Checking detector…'}
              </ThemedText>
            </View>
          </View>

          {/* 1. Type */}
          <View style={styles.card}>
            <ThemedText style={styles.cardLabel}>What is blocking the way?</ThemedText>
            <View style={styles.typeGrid}>
              {(Object.keys(HAZARD_META) as HazardType[]).map((type) => {
                const meta = HAZARD_META[type];
                const selected = selectedType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeChip, selected && { borderColor: meta.color, backgroundColor: `${meta.color}1f` }]}
                    onPress={() => setSelectedType(type)}
                    activeOpacity={0.75}
                  >
                    <MaterialIcons name={meta.icon} size={22} color={selected ? meta.color : '#64748b'} />
                    <ThemedText style={[styles.typeChipLabel, selected && { color: meta.color }]} numberOfLines={2}>
                      {meta.label}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 2. Location */}
          <View style={styles.card}>
            <ThemedText style={styles.cardLabel}>Where is it?</ThemedText>
            <TextInput
              style={styles.inputField}
              placeholder="e.g. 14th & Park Rd NW, NE corner"
              placeholderTextColor="#5b6b7b"
              value={locationText}
              onChangeText={setLocationText}
            />
            <TouchableOpacity style={styles.gpsRow} onPress={pickGps} activeOpacity={0.8}>
              {gpsBusy ? (
                <ActivityIndicator size="small" color="#22c55e" />
              ) : (
                <MaterialIcons name="my-location" size={17} color="#22c55e" />
              )}
              <ThemedText style={styles.gpsText}>
                {gpsBusy
                  ? 'Getting location…'
                  : coords
                    ? `GPS attached · ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
                    : 'Use my location'}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* 3. Details */}
          <View style={styles.card}>
            <ThemedText style={styles.cardLabel}>Details (optional)</ThemedText>
            <TextInput
              style={[styles.inputField, styles.textAreaField]}
              placeholder="What exactly is blocked? Any workaround?"
              placeholderTextColor="#5b6b7b"
              multiline
              value={description}
              onChangeText={setDescription}
            />
          </View>

          {/* 4. Photo + AI */}
          <View style={styles.card}>
            <ThemedText style={styles.cardLabel}>Photo evidence</ThemedText>
            <View style={styles.photoActionsRow}>
              <TouchableOpacity style={styles.photoActionBtn} onPress={() => void handlePhotoAction('camera')} activeOpacity={0.75}>
                <MaterialIcons name="photo-camera" size={18} color="#22c55e" />
                <ThemedText style={styles.photoActionText}>Camera</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.photoActionBtn} onPress={() => void handlePhotoAction('library')} activeOpacity={0.75}>
                <MaterialIcons name="photo-library" size={18} color="#22c55e" />
                <ThemedText style={styles.photoActionText}>Library</ThemedText>
              </TouchableOpacity>
            </View>
            {photoUri ? (
              <View style={styles.photoPreviewWrap}>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                <TouchableOpacity style={styles.removePhotoBtn} onPress={() => { setPhotoUri(null); setDetections(null); setAiChecked(false); }}>
                  <MaterialIcons name="close" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : null}
            {photoUri ? (
              <TouchableOpacity
                style={[styles.aiButton, analyzing && { opacity: 0.6 }]}
                onPress={() => void runAiCheck()}
                disabled={analyzing}
                activeOpacity={0.8}
              >
                {analyzing ? (
                  <ActivityIndicator size="small" color="#0c1210" />
                ) : (
                  <MaterialIcons name="auto-awesome" size={17} color="#0c1210" />
                )}
                <ThemedText style={styles.aiButtonText}>
                  {analyzing ? 'Scanning photo…' : 'Run AI barrier check'}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
            {aiChecked && detections !== null ? (
              <View style={styles.aiChipsRow}>
                {detections.length > 0 ? (
                  detections.map((d, i) => (
                    <View key={`${d.class}-${i}`} style={styles.aiChip}>
                      <ThemedText style={styles.aiChipText}>
                        {`${d.class} · ${Math.round(d.confidence * 100)}%`}
                      </ThemedText>
                    </View>
                  ))
                ) : (
                  <View style={styles.aiChipOk}>
                    <MaterialIcons name="verified" size={14} color="#4ade80" />
                    <ThemedText style={styles.aiChipOkText}>No barriers detected</ThemedText>
                  </View>
                )}
              </View>
            ) : null}
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.actionButton, submitting && { opacity: 0.6 }]}
            onPress={() => void handleSubmit()}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <MaterialIcons name="campaign" size={20} color="#fff" />
            )}
            <ThemedText style={styles.actionButtonText}>
              {submitting ? 'Submitting…' : 'Submit hazard report'}
            </ThemedText>
          </TouchableOpacity>

          {/* Community feed */}
          <View style={styles.feedCard}>
            <View style={styles.feedHead}>
              <MaterialIcons name="groups" size={17} color="#94a3b8" />
              <ThemedText style={styles.feedTitle}>Community reports</ThemedText>
              <TouchableOpacity style={{ marginLeft: 'auto' }} onPress={() => void loadReports()} hitSlop={8}>
                <MaterialIcons name="refresh" size={16} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            {reportsLoading ? (
              <ActivityIndicator color="#22c55e" style={styles.feedSpinner} />
            ) : reports.length === 0 ? (
              <ThemedText style={styles.feedEmpty}>
                No reports yet — be the first to log a hazard in your neighborhood.
              </ThemedText>
            ) : (
              reports.slice(0, 8).map((r) => {
                const meta = HAZARD_META[(r.type as HazardType) in HAZARD_META ? (r.type as HazardType) : 'Other'];
                return (
                  <View key={r.id} style={styles.feedRow}>
                    <View style={[styles.feedIcon, { backgroundColor: `${meta.color}1f` }]}>
                      <MaterialIcons name={meta.icon} size={16} color={meta.color} />
                    </View>
                    <View style={styles.feedBody}>
                      <ThemedText style={styles.feedRowTitle}>
                        {meta.label}
                        {r.description ? ` · ${r.description}` : ''}
                      </ThemedText>
                      <ThemedText style={styles.feedRowMeta}>
                        {timeAgo(r.ts)}
                        {r.lat !== 0 || r.lng !== 0 ? ` · ${r.lat.toFixed(3)}, ${r.lng.toFixed(3)}` : ''}
                        {r.photo ? ' · 📷 photo' : ''}
                      </ThemedText>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Platform.OS === 'web' ? 84 : Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  header: { gap: Spacing.two, marginBottom: Spacing.one },
  title: { fontSize: 26, fontWeight: '900' },
  subtitle: { fontSize: 14, opacity: 0.65, lineHeight: 20 },
  svcPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.14)',
  },
  svcDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  svcPillText: { fontSize: 11.5, fontWeight: '600' },
  card: {
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardLabel: { fontSize: 12.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.75 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  typeChip: {
    width: '47.5%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(148,163,184,0.06)',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    gap: 6,
  },
  typeChipLabel: { fontSize: 12.5, fontWeight: '700', color: '#cbd5e1' },
  inputField: {
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    height: 44,
    fontSize: 14,
    color: '#e2e8f0',
    backgroundColor: 'rgba(148,163,184,0.05)',
  },
  textAreaField: { height: 78, paddingTop: Spacing.two, textAlignVertical: 'top' },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(34,197,94,0.12)',
  },
  gpsText: { fontSize: 12.5, fontWeight: '700', color: '#4ade80' },
  photoActionsRow: { flexDirection: 'row', gap: Spacing.two },
  photoActionBtn: {
    flex: 1,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    backgroundColor: 'rgba(148,163,184,0.05)',
  },
  photoActionText: { fontSize: 13, fontWeight: '700', color: '#cbd5e1' },
  photoPreviewWrap: {
    position: 'relative',
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
  },
  photoPreview: { width: '100%', height: '100%' },
  removePhotoBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiButton: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: '#a3e635',
  },
  aiButtonText: { color: '#0c1210', fontSize: 14, fontWeight: '800' },
  aiChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  aiChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(163,230,53,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(163,230,53,0.35)',
  },
  aiChipText: { fontSize: 11.5, fontWeight: '700', color: '#bef264' },
  aiChipOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.35)',
  },
  aiChipOkText: { fontSize: 11.5, fontWeight: '700', color: '#4ade80' },
  actionButton: {
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#e11d48',
  },
  actionButtonText: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  feedCard: {
    backgroundColor: 'rgba(148,163,184,0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  feedHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feedTitle: { fontSize: 14, fontWeight: '800', color: '#f1f5f9' },
  feedSpinner: { alignSelf: 'center', paddingVertical: Spacing.three },
  feedEmpty: { fontSize: 13, opacity: 0.55, lineHeight: 19 },
  feedRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingTop: Spacing.one },
  feedIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedBody: { flex: 1 },
  feedRowTitle: { fontSize: 12.5, fontWeight: '600', color: '#e2e8f0', lineHeight: 17 },
  feedRowMeta: { fontSize: 11, opacity: 0.5, marginTop: 1 },
  confirmWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  successIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.one,
  },
  summaryCard: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(148,163,184,0.08)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryText: { fontSize: 13, flex: 1 },
});
