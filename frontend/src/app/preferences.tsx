import React, { useState } from 'react';
import { StyleSheet, View, Switch, TouchableOpacity, ScrollView, useColorScheme } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, Colors } from '@/constants/theme';

type RoutingMode = 'standard' | 'wheelchair';

export default function PreferencesScreen() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  // User Preference State Management Hooks
  const [routingMode, setRoutingMode] = useState<RoutingMode>('standard');
  const [preferSidewalks, setPreferSidewalks] = useState(true);
  const [wellLitOnly, setWellLitOnly] = useState(false);
  const [lowTraffic, setLowTraffic] = useState(false);
  const [avoidObstacles, setAvoidObstacles] = useState(true);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          {/* Header Block */}
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>Preferences</ThemedText>
            <ThemedText style={styles.subtitle}>
              Customize your walking parameters to generate the safest pedestrian routes.
            </ThemedText>
          </View>

          {/* Section 1: Accessibility Base Mode Selector */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>1. Routing Access Mode</ThemedText>
            <View style={[styles.toggleGroupContainer, { borderColor: colors.backgroundElement }]}>
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  routingMode === 'standard' && { backgroundColor: '#3498db' }
                ]}
                onPress={() => setRoutingMode('standard')}
                activeOpacity={0.8}
              >
                <ThemedText style={[styles.toggleButtonText, routingMode === 'standard' && styles.textActive]}>
                  Standard walking
                </ThemedText>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  routingMode === 'wheelchair' && { backgroundColor: '#3498db' }
                ]}
                onPress={() => setRoutingMode('wheelchair')}
                activeOpacity={0.8}
              >
                <ThemedText style={[styles.toggleButtonText, routingMode === 'wheelchair' && styles.textActive]}>
                  Wheelchair / accessible
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {/* Section 2: Infrastructure Safety Flags */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>2. Path & Infrastructure Settings</ThemedText>
            
            <View style={[styles.settingRow, { borderBottomWidth: 1, borderColor: colors.backgroundElement }]}>
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>Prioritize Sidewalks</ThemedText>
                <ThemedText style={styles.settingDescription}>Avoid paths missing dedicated pedestrian walkways.</ThemedText>
              </View>
              <Switch
                value={preferSidewalks}
                onValueChange={setPreferSidewalks}
                trackColor={{ false: '#767577', true: '#2ecc71' }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>Protected Crossings Only</ThemedText>
                <ThemedText style={styles.settingDescription}>Route through marked crosswalks and traffic signals.</ThemedText>
              </View>
              <Switch
                value={avoidObstacles}
                onValueChange={setAvoidObstacles}
                trackColor={{ false: '#767577', true: '#2ecc71' }}
                thumbColor="#ffffff"
              />
            </View>
          </View>

          {/* Section 3: Environmental Safety Filters */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>3. Environmental Conditions</ThemedText>

            <View style={[styles.settingRow, { borderBottomWidth: 1, borderColor: colors.backgroundElement }]}>
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>Enhanced Safety Lighting</ThemedText>
                <ThemedText style={styles.settingDescription}>Prioritize well-lit streets during evening strolls.</ThemedText>
              </View>
              <Switch
                value={wellLitOnly}
                onValueChange={setWellLitOnly}
                trackColor={{ false: '#767577', true: '#2ecc71' }}
                thumbColor="#ffffff"
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>Low Traffic Exposure</ThemedText>
                <ThemedText style={styles.settingDescription}>Steer away from high-speed arterial roadways and exhaust.</ThemedText>
              </View>
              <Switch
                value={lowTraffic}
                onValueChange={setLowTraffic}
                trackColor={{ false: '#767577', true: '#2ecc71' }}
                thumbColor="#ffffff"
              />
            </View>
          </View>

          {/* Configuration State Tracker Display */}
          <View style={[styles.statusFeedbackBox, { backgroundColor: colors.backgroundElement }]}>
            <ThemedText style={styles.statusBoxText}>
              Stryde safety filters configured for{' '}
              <ThemedText style={{ fontWeight: '700' }}>
                {routingMode === 'standard' ? 'Standard Pedestrian' : 'Wheelchair Access'}
              </ThemedText>{' '}
              metrics.
            </ThemedText>
          </View>

        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.five,
  },
  header: {
    marginBottom: Spacing.one,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    marginBottom: Spacing.one,
  },
  subtitle: {
    fontSize: 15,
    opacity: 0.6,
    lineHeight: 20,
  },
  section: {
    gap: Spacing.three,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.8,
  },
  toggleGroupContainer: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    height: 46,
    width: '100%',
  },
  toggleButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.01)',
  },
  toggleButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  textActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: Spacing.four,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    opacity: 0.5,
    lineHeight: 16,
  },
  statusFeedbackBox: {
    width: '100%',
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  statusBoxText: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    opacity: 0.8,
  },
});
