import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemedView } from "@/components/themed-view";
import { HazardsPanel } from "@/components/hazards-panel";
import { Spacing } from "@/constants/theme";

/**
 * Standalone street-hazards screen (behind this URL for deep links; the map
 * screen reaches the same experience via its drawer's "Hazards" subtab).
 */
export default function HazardsScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <View style={styles.body}>
          <HazardsPanel
            topInset={Platform.OS === "web" ? Spacing.three + 22 : Spacing.three}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  body: { flex: 1 },
});
