import { api } from '@/api/api';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';

type RoutingMode = 'standard' | 'wheelchair';

type Prefs = {
  routingMode: RoutingMode;
  preferSidewalks: boolean;
  wellLitOnly: boolean;
  lowTraffic: boolean;
  avoidObstacles: boolean;
};

const DEFAULT_PREFS: Prefs = {
  routingMode: 'standard',
  preferSidewalks: true,
  wellLitOnly: false,
  lowTraffic: false,
  avoidObstacles: true,
};

const FLAGS = [
  { key: 'avoidObstacles', title: 'Protected crossings', icon: 'traffic' as const, desc: 'Cross at signals and marked crosswalks' },
  { key: 'preferSidewalks', title: 'Prefer sidewalks', icon: 'directions-walk' as const, desc: 'Skip streets without walkways' },
  { key: 'wellLitOnly', title: 'Well-lit streets', icon: 'lightbulb' as const, desc: 'Brighter paths for evening walks' },
  { key: 'lowTraffic', title: 'Low-traffic streets', icon: 'volume-off' as const, desc: 'Avoid high-speed arterials' },
] as const;

export type RouteSidebarProps = {
  onUpdateRoute: () => void;
  canUpdate: boolean;
  updating: boolean;
  lastUpdated: number | null;
  /** Extra top padding so headers don't overlap content. */
  topInset?: number;
};

/**
 * Quick route-settings (mode chips + safety flags + re-plan). Changes persist
 * to the backend immediately; "Update Route" asks the parent screen to
 * re-score with the newest settings and hazard data.
 */
export function RouteSidebar({ onUpdateRoute, canUpdate, updating, lastUpdated, topInset = 0 }: RouteSidebarProps) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [settle, setSettle] = useState<'loading' | 'idle' | 'saved' | 'error'>('loading');
  const hydrated = useRef(false);

  useEffect(() => {
    let alive = true;
    api
      .getPreferences()
      .then((saved) => {
        if (!alive) return;
        setPrefs((prev) => ({
          routingMode: typeof saved.routingMode === 'string' && saved.routingMode === 'wheelchair' ? 'wheelchair' : prev.routingMode,
          preferSidewalks: typeof saved.preferSidewalks === 'boolean' ? saved.preferSidewalks : prev.preferSidewalks,
          wellLitOnly: typeof saved.wellLitOnly === 'boolean' ? saved.wellLitOnly : prev.wellLitOnly,
          lowTraffic: typeof saved.lowTraffic === 'boolean' ? saved.lowTraffic : prev.lowTraffic,
          avoidObstacles: typeof saved.avoidObstacles === 'boolean' ? saved.avoidObstacles : prev.avoidObstacles,
        }));
      })
      .catch(() => {})
      .finally(() => {
        if (alive) {
          hydrated.current = true;
          setSettle('idle');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    setSettle('idle');
    const t = setTimeout(() => {
      api
        .savePreferences(prefs)
        .then(() => setSettle('saved'))
        .catch(() => setSettle('error'));
    }, 500);
    return () => clearTimeout(t);
  }, [prefs]);

  const setKey = (key: (typeof FLAGS)[number]['key'], value: boolean) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const timeLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingTop: topInset }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <ThemedText style={styles.sectionTitle}>How do you walk?</ThemedText>
          <View style={styles.savedBadge}>
            {settle === 'loading' ? (
              <ActivityIndicator size="small" color="#94a3b8" />
            ) : settle === 'saved' ? (
              <>
                <MaterialIcons name="check-circle" size={12} color="#4ade80" />
                <ThemedText style={styles.savedText}>Saved</ThemedText>
              </>
            ) : settle === 'error' ? (
              <MaterialIcons name="wifi-off" size={12} color="#f87171" />
            ) : null}
          </View>
        </View>
        <View style={styles.modeRow}>
          {(
            [
              { id: 'standard', label: 'Standard', icon: 'directions-walk' as const },
              { id: 'wheelchair', label: 'Wheelchair', icon: 'accessible' as const },
            ] as const
          ).map((opt) => {
            const selected = prefs.routingMode === opt.id;
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.modeChip, selected && styles.modeChipOn]}
                onPress={() => setPrefs((p) => ({ ...p, routingMode: opt.id }))}
                activeOpacity={0.8}
              >
                <MaterialIcons name={opt.icon} size={16} color={selected ? '#22c55e' : '#64748b'} />
                <ThemedText style={[styles.modeChipText, selected && { color: '#4ade80' }]}>
                  {opt.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
        {FLAGS.map((flag) => {
          const on = prefs[flag.key];
          return (
            <View key={flag.key} style={[styles.flagRow, on && styles.flagRowOn]}>
              <MaterialIcons name={flag.icon} size={16} color={on ? '#22c55e' : '#64748b'} />
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.flagTitle}>{flag.title}</ThemedText>
                <ThemedText style={styles.flagDesc} numberOfLines={1}>{flag.desc}</ThemedText>
              </View>
              <Switch
                value={on}
                onValueChange={(v) => setKey(flag.key, v)}
                trackColor={{ false: 'rgba(148,163,184,0.3)', true: '#22c55e' }}
                thumbColor="#fff"
                style={styles.switch}
              />
            </View>
          );
        })}
      </View>

      {/* Re-plan button */}
      <TouchableOpacity
        style={[styles.updateBtn, (updating || !canUpdate) && { opacity: 0.55 }]}
        onPress={onUpdateRoute}
        disabled={updating || !canUpdate}
        activeOpacity={0.85}
      >
        {updating ? (
          <ActivityIndicator size="small" color="#0c1210" />
        ) : (
          <MaterialIcons name="refresh" size={17} color="#0c1210" />
        )}
        <ThemedText style={styles.updateText}>
          {updating ? 'Re-planning…' : 'Update Route'}
        </ThemedText>
      </TouchableOpacity>
      <ThemedText style={styles.stampText}>
        {canUpdate ? `Last re-scored ${timeLabel}` : 'Set start and destination to plan'}
      </ThemedText>

      <ThemedView style={styles.aboutCard}>
        <MaterialIcons name="tips-and-updates" size={16} color="#94a3b8" />
        <ThemedText style={styles.aboutText}>
          Switch settings here, then tap “Update Route” — the three suggestions
          re-plot on the map with your newest priorities and hazard data.
        </ThemedText>
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.two + 12, paddingVertical: Spacing.two, gap: Spacing.two },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    backgroundColor: 'rgba(148,163,184,0.06)',
    padding: Spacing.two + 2,
    gap: Spacing.two,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modeChip: {
    flex: 1,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  modeChipOn: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' },
  modeChipText: { fontSize: 12.5, fontWeight: '700', color: '#cbd5e1' },
  savedBadge: { alignItems: 'center', flexDirection: 'row', gap: 3 },
  savedText: { fontSize: 10.5, fontWeight: '700', color: '#4ade80' },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.16)',
    backgroundColor: 'rgba(148,163,184,0.04)',
    paddingHorizontal: Spacing.two,
  },
  flagRowOn: { borderColor: 'rgba(34,197,94,0.45)' },
  flagTitle: { fontSize: 13, fontWeight: '600', color: '#e2e8f0' },
  flagDesc: { fontSize: 10.5, opacity: 0.5, marginTop: 1 },
  switch: { transform: [{ scale: 0.82 }], marginRight: -6 },
  updateBtn: {
    height: 46,
    borderRadius: 999,
    backgroundColor: '#34d399',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  updateText: { color: '#0c1210', fontSize: 14.5, fontWeight: '800' },
  stampText: { fontSize: 10.5, opacity: 0.45, textAlign: 'center' },
  aboutCard: {
    flexDirection: 'row',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.1)',
    backgroundColor: 'rgba(148,163,184,0.04)',
    padding: Spacing.two,
  },
  aboutText: { flex: 1, fontSize: 11.5, opacity: 0.6, lineHeight: 16 },
});
