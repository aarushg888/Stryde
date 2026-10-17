import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../stride/colors';
import { hasApi } from '../stride/api';

export default function ReportedConfirmation() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.fill, { paddingBottom: insets.bottom + 16 }]}>
      <Text style={styles.title} accessibilityRole="header">
        Hazard reported
      </Text>
      <Text style={styles.body}>
        {hasApi
          ? 'Your report was sent to the team database.'
          : 'Your report is saved on this device only for now, and shows on your map straight away. It will be sent to the city database once the backend is connected.'}
      </Text>
      <View style={styles.actions}>
        <Pressable
          style={styles.primary}
          onPress={() => router.replace('/')}
          accessibilityRole="button"
          accessibilityLabel="Back to the map"
        >
          <Text style={styles.primaryText}>Back to the map</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Report another hazard"
        >
          <Text style={styles.secondaryText}>Report another hazard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.paper,
    padding: 24,
    justifyContent: 'center',
    gap: 16,
  },
  title: { fontSize: 26, fontWeight: '700', color: colors.ink },
  body: { fontSize: 15, lineHeight: 21, color: colors.inkSoft },
  actions: { gap: 12, marginTop: 12 },
  primary: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  secondary: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: colors.green, fontWeight: '600', fontSize: 16 },
});
