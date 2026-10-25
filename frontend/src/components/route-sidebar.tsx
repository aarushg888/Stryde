import { api, type HazardReport } from '@/api/api';
import { ThemedText } from './themed-text';
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
import { ThemedView } from './themed-view';

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
  { key: 'preferSidewalks', title: 'Prefer sidewalks', icon: 'directions-walk' as const },
  { key: 'avoidObstacles', title: 'Protected crossings', icon: 'traffic' as const },
  { key: 'wellLitOnly', title: 'Well-lit streets', icon: 'lightbulb' as const },
  { key: 'lowTraffic', title: 'Low-traffic streets', icon: 'volume-off' as const },
] as const;

const HAZARD_EMOJI: Record<string, string> = {
  Sidewalk: '♿',
  Tree: '🌳',
  Construction: '🚧',
  Other: '❗',
};

export type RouteSidebarProps = {
  onUpdateRoute: () => void;
  canUpdate: boolean;
  updating: boolean;
  lastUpdated: number | null;
  onHazards?: (hazards: HazardReport[]) => void;
  /** Top padding so the floating web tab pill doesn't overlap content. */
  topInset?: number;
};

/**
 * Inline route-settings + live hazard layer shown next to the map on wide
 * screens. Changes persist to the backend immediately; "Update Route" asks the
 * parent screen to re-score with the newest settings and hazard data.
 */
export function RouteSidebar({ onUpdateRoute, canUpdate, updating, lastUpdated, onHazards, topInset = 74 }: RouteSidebarProps) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [settle, setSettle] = useState<'loading' | 'idle' | 'saved' | 'error'>('loading');
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  const [hazardsLoading, setHazardsLoading] = useState(true);
  const hydrated = useRef(false);

  useEffect(() => {
    api
      .getPreferences()
      .then((saved) => {
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
        hydrated.current = true;
        setSettle('idle');
      });
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

  const loadHazards = () => {
    setHazardsLoading(true);
    api
      .listHazards(30)
      .then((res) => {
        setHazards(res.hazards);
        onHazards?.(res.hazards);
      })
      .catch(() => {})
      .finally(() => setHazardsLoading(false));
  };

  useEffect(() => {
    let alive = true;
    api
      .listHazards(30)
      .then((res) => {
        if (!alive) return;
        setHazards(res.hazards);
        onHazards?.(res.hazards);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setHazardsLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setKey = (key: (typeof FLAGS)[number]['key'], value: boolean) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const timeLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <ThemedView style={styles.panel}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topInset }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Route settings */}
        <ThemedText style={styles.sectionTitle}>Route settings</ThemedText>
        <View style={styles.card}>
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
          {FLAGS.map((flag) => (
            <View key={flag.key} style={styles.flagRow}>
              <MaterialIcons name={flag.icon} size={15} color={prefs[flag.key] ? '#22c55e' : '#64748b'} />
              <ThemedText style={styles.flagLabel}>{flag.title}</ThemedText>
              <Switch
                value={prefs[flag.key]}
                onValueChange={(v) => setKey(flag.key, v)}
                trackColor={{ false: 'rgba(148,163,184,0.3)', true: '#22c55e' }}
                thumbColor="#fff"
                style={styles.switch}
              />
            </View>
          ))}
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

        {/* Community hazard layer */}
        <View style={styles.feedHead}>
          <MaterialIcons name="report" size={15} color="#94a3b8" />
          <ThemedText style={styles.sectionTitleTight}>Hazard reports</ThemedText>
          <TouchableOpacity onPress={loadHazards} hitSlop={8} style={{ marginLeft: 'auto' }}>
            <MaterialIcons name="refresh" size={14} color="#94a3b8" />
          </TouchableOpacity>
        </View>
        <ThemedText style={styles.feedHint}>
          Shown as small badges on the map — the Safest route detours around them.
        </ThemedText>
        <View style={styles.card}>
          {hazardsLoading ? (
            <ActivityIndicator color="#22c55e" style={styles.feedSpinner} />
          ) : hazards.length === 0 ? (
            <ThemedText style={styles.emptyText}>No community reports yet.</ThemedText>
          ) : (
            hazards.slice(0, 6).map((h) => (
              <View key={h.id} style={styles.hazardRow}>
                <View style={styles.hazardEmoji}>
                  <ThemedText style={styles.hazardEmojiText}>
                    {HAZARD_EMOJI[h.type] ?? '❗'}
                  </ThemedText>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.hazardTitle} numberOfLines={1}>
                    {h.type}
                    {h.description ? ` · ${h.description}` : ''}
                  </ThemedText>
                  {(h.lat !== 0 || h.lng !== 0) && (
                    <ThemedText style={styles.hazardMeta}>
                      {h.lat.toFixed(3)}, {h.lng.toFixed(3)}
                    </ThemedText>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  scroll: { paddingHorizontal: Spacing.two + 24, gap: Spacing.two },
  sectionTitle: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.65 },
  sectionTitleTight: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.65,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    backgroundColor: 'rgba(148,163,184,0.06)',
    padding: Spacing.two + 2,
    gap: Spacing.two,
  },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modeChip: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.22)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  modeChipOn: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' },
  modeChipText: { fontSize: 12, fontWeight: '700', color: '#cbd5e1' },
  savedBadge: { width: 44, alignItems: 'center', flexDirection: 'row', gap: 3, justifyContent: 'center' },
  savedText: { fontSize: 10.5, fontWeight: '700', color: '#4ade80' },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34 },
  flagLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: '#e2e8f0' },
  switch: { transform: [{ scale: 0.8 }], marginRight: -6 },
  updateBtn: {
    height: 46,
    borderRadius: 999,
    backgroundColor: '#34d399',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.one,
  },
  updateText: { color: '#0c1210', fontSize: 14.5, fontWeight: '800' },
  stampText: { fontSize: 10.5, opacity: 0.45, textAlign: 'center' },
  feedHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.two },
  feedHint: { fontSize: 11, opacity: 0.45, lineHeight: 15 },
  feedSpinner: { alignSelf: 'center', paddingVertical: Spacing.three },
  emptyText: { fontSize: 12, opacity: 0.5 },
  hazardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 3 },
  hazardEmoji: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(240,190,60,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hazardEmojiText: { fontSize: 13 },
  hazardTitle: { fontSize: 12, fontWeight: '600', color: '#e2e8f0' },
  hazardMeta: { fontSize: 10, opacity: 0.45, marginTop: 1 },
});
