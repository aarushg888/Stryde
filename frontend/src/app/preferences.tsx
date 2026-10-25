import React from "react";
import { Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedView } from "@/components/themed-view";
import { PreferencesPanel } from "@/components/preferences-panel";
import { Spacing } from "@/constants/theme";

/**
 * Standalone preferences screen (behind this URL for deep links; the map
 * screen reaches the same experience via its drawer's "Preferences" subtab).
 */
export default function PreferencesScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <PreferencesPanel
          topInset={Platform.OS === "web" ? Spacing.three + 22 : Spacing.three}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
});
