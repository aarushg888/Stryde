import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../stride/colors';
import { PROFILES } from '../stride/profiles';
import { useStore } from '../stride/store';

export default function PreferencesScreen() {
  const insets = useSafeAreaInsets();
  const { preferences, updatePreferences } = useStore();

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 16 }]}
    >
      <Text style={styles.heading} accessibilityRole="header">
        Walking preferences
      </Text>
      <Text style={styles.note}>
        Slope and kerb limits are used for the wheelchair and stroller profiles. The other
        markers need data the app does not have yet, so they are saved but unused.
      </Text>

      <Text style={styles.section}>I&apos;m getting around by</Text>
      <View style={styles.chips}>
        {PROFILES.map((p) => {
          const on = p.id === preferences.profileId;
          return (
            <Pressable
              key={p.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => updatePreferences({ profileId: p.id })}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Travel by ${p.label}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.section}>On the route</Text>
      <ToggleRow
        label="Prefer sidewalks"
        value={preferences.preferSidewalks}
        note="Needs a sidewalk dataset. Placeholder for now."
        onChange={(v) => updatePreferences({ preferSidewalks: v })}
      />
      <ToggleRow
        label="Prefer protected crossings"
        value={preferences.preferProtectedCrossings}
        note="Needs crossing data. Placeholder for now."
        onChange={(v) => updatePreferences({ preferProtectedCrossings: v })}
      />
      <ToggleRow
        label="Prefer well-lit streets"
        value={preferences.wellLit}
        note="Needs lighting data. Placeholder for now."
        onChange={(v) => updatePreferences({ wellLit: v })}
      />
      <ToggleRow
        label="Prefer quieter streets"
        value={preferences.lowTraffic}
        note="Uses a standard walking route for now."
        onChange={(v) => updatePreferences({ lowTraffic: v })}
      />

      <Text style={styles.section}>Accessibility limits</Text>
      <View style={styles.rowWrap}>
        <Text style={styles.rowLabel}>Maximum slope</Text>
        {[6, 10, 15].map((pct) => {
          const on = preferences.maxInclinePct === pct;
          return (
            <Pressable
              key={pct}
              style={[styles.limitsChip, on && styles.limitsChipOn]}
              onPress={() => updatePreferences({ maxInclinePct: pct })}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Maximum slope ${pct} percent`}
            >
              <Text style={[styles.limitsText, on && styles.limitsTextOn]}>{pct}%</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.rowWrap}>
        <Text style={styles.rowLabel}>Maximum kerb height</Text>
        {[0.06, 0.12].map((m) => {
          const on = preferences.maxKerbM === m;
          return (
            <Pressable
              key={m}
              style={[styles.limitsChip, on && styles.limitsChipOn]}
              onPress={() => updatePreferences({ maxKerbM: m })}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Maximum kerb height ${m * 100} centimetres`}
            >
              <Text style={[styles.limitsText, on && styles.limitsTextOn]}>{m * 100} cm</Text>
            </Pressable>
          );
        })}
      </View>
      <ToggleRow
        label="Paved surfaces only"
        value={preferences.pavedOnly}
        note="Skips gravel, sand and similar."
        onChange={(v) => updatePreferences({ pavedOnly: v })}
      />

      <Pressable
        style={styles.done}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back to the map"
      >
        <Text style={styles.doneText}>Back to the map</Text>
      </Pressable>
    </ScrollView>
  );
}

function ToggleRow({
  label,
  value,
  note,
  onChange,
}: {
  label: string;
  value: boolean;
  note?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleTexts}>
        <Text style={styles.rowLabel}>{label}</Text>
        {note && <Text style={styles.toggleNote}>{note}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.line, true: colors.green }}
        thumbColor="#FFFFFF"
        // 51x31 native - wrapped row keeps the touch target well over 48px.
        style={styles.switch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.paper },
  inner: { padding: 16 },
  heading: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  note: { fontSize: 14, color: colors.inkSoft },
  section: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 24,
    marginBottom: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  toggleRow: {
    minHeight: 64,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleTexts: { flex: 1 },
  rowLabel: { fontSize: 15, color: colors.ink, fontWeight: '500' },
  toggleNote: { fontSize: 12, color: colors.inkSoft, marginTop: 2 },
  switch: { marginRight: 4 },
  rowWrap: {
    minHeight: 64,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  limitsChip: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginRight: 8,
    alignSelf: 'flex-start',
  },
  limitsChipOn: { backgroundColor: colors.green, borderColor: colors.green },
  limitsText: { fontSize: 14, color: colors.ink },
  limitsTextOn: { color: '#FFFFFF', fontWeight: '600' },
  done: {
    minHeight: 48,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { color: colors.green, fontWeight: '600', fontSize: 16 },
});
