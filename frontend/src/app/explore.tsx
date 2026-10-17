import React, { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WebBadge } from '@/components/web-badge';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface RouteOption {
  id: string;
  name: string;
  tag: string;
  tagColor: string;
  distance: string;
  time: string;
  sidewalkInfo: string;
  crossingInfo: string;
  hazardsCount: number;
  hazardsList: string[];
  accessibility: string;
  isWheelchairFriendly: boolean;
}

export default function TabTwoScreen() {
  const safeAreaInsets = useSafeAreaInsets();
  
  // Adjusted baseline offsets to nudge the overall viewport lower safely
  const insets = {
    ...safeAreaInsets,
    top: safeAreaInsets.top + Spacing.four, // Injected extra spacer buffer for top padding alignment
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };
  const theme = useTheme();
  
  const [selectedRoute, setSelectedRoute] = useState<string>('route-1');

  const routesData: RouteOption[] = [
    {
      id: 'route-1',
      name: 'Safety First Path',
      tag: 'RECOMMENDED',
      tagColor: '#2ecc71',
      distance: '1.2 miles',
      time: '24 mins',
      sidewalkInfo: '100% continuous wide paved paths',
      crossingInfo: 'All protected intersections with audio indicators',
      hazardsCount: 0,
      hazardsList: [],
      accessibility: 'Fully optimized for rolling devices and low visibility',
      isWheelchairFriendly: true,
    },
    {
      id: 'route-2',
      name: 'Direct Boulevard Route',
      tag: 'SHORTEST',
      tagColor: '#3498db',
      distance: '0.8 miles',
      time: '15 mins',
      sidewalkInfo: '85% coverage, missing curb cuts on 4th Ave',
      crossingInfo: '2 unmarked mid-block pedestrian segments',
      hazardsCount: 1,
      hazardsList: ['Active construction blocking lane near Broadway'],
      accessibility: 'Steep inclines, lacks structural tactile guide lines',
      isWheelchairFriendly: false,
    },
    {
      id: 'route-3',
      name: 'Illuminated Evening Route',
      tag: 'WELL-LIT',
      tagColor: '#f1c40f',
      distance: '1.5 miles',
      time: '30 mins',
      sidewalkInfo: '95% coverage, wide paths along retail sector',
      crossingInfo: 'Fully signalized standard crosswalk grids',
      hazardsCount: 1,
      hazardsList: ['Fallen branch debris partially blocking side avenue'],
      accessibility: 'Gentle grade slopes, optimal ambient lighting density',
      isWheelchairFriendly: true,
    },
  ];

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
    },
    web: {
      paddingTop: Spacing.six, // Shifted web views down slightly as well
      paddingBottom: Spacing.four,
    },
  });

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={insets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}>
      
      {/* Added an extra top container margin to guarantee an uniform layout push down across all devices */}
      <ThemedView style={styles.container}>
        
        <ThemedView style={styles.titleContainer}>
          <ThemedText type="subtitle" style={styles.headerTitle}>Safer Route Explorer</ThemedText>
          <ThemedText style={styles.centerText} themeColor="textSecondary">
            Compare candidate paths custom tailored to infrastructure condition metrics.
          </ThemedText>
        </ThemedView>

        <View style={styles.routesListWrapper}>
          {routesData.map((route) => {
            const isSelected = selectedRoute === route.id;
            return (
              <Pressable
                key={route.id}
                onPress={() => setSelectedRoute(route.id)}
                style={({ pressed }) => [
                  styles.routeCard,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                  isSelected && styles.routeCardSelected,
                  pressed && styles.pressed,
                ]}>
                
                <View style={styles.cardHeaderRow}>
                  <View style={styles.routeNameWrapper}>
                    <ThemedText style={styles.routeNameText}>{route.name}</ThemedText>
                    {route.isWheelchairFriendly && (
                      <View style={styles.accessibleBadge}>
                        <SymbolView name="figure.roll.runningpace" size={13} tintColor={theme.text} />
                      </View>
                    )}
                  </View>
                  <View style={[styles.ribbonTag, { backgroundColor: route.tagColor }]}>
                    <ThemedText style={styles.ribbonTagText}>{route.tag}</ThemedText>
                  </View>
                </View>

                <View style={styles.metricsGrid}>
                  <View style={styles.metricItem}>
                    <SymbolView name="figure.walk" size={16} tintColor={theme.text} />
                    <ThemedText style={styles.metricTextBold}>{route.distance}</ThemedText>
                  </View>
                  <View style={styles.metricItem}>
                    <SymbolView name="clock" size={14} tintColor={theme.text} />
                    <ThemedText style={styles.metricTextBold}>{route.time}</ThemedText>
                  </View>
                  <View style={styles.metricItem}>
                    <SymbolView 
                      name={route.hazardsCount > 0 ? "exclamationmark.triangle.fill" : "checkmark.shield.fill"} 
                      size={14} 
                      tintColor={route.hazardsCount > 0 ? "#e74c3c" : "#2ecc71"} 
                    />
                    <ThemedText style={[
                      styles.metricTextBold, 
                      { color: route.hazardsCount > 0 ? '#e74c3c' : '#2ecc71' }
                    ]}>
                      {route.hazardsCount === 0 ? 'Clear path' : `${route.hazardsCount} alert`}
                    </ThemedText>
                  </View>
                </View>

                {isSelected && (
                  <View style={[styles.detailPane, { borderTopColor: theme.border }]}>
                    <View style={styles.infoLine}>
                      <ThemedText style={styles.infoLabel}>Sidewalks:</ThemedText>
                      <ThemedText style={styles.infoValue}>{route.sidewalkInfo}</ThemedText>
                    </View>
                    <View style={styles.infoLine}>
                      <ThemedText style={styles.infoLabel}>Crossings:</ThemedText>
                      <ThemedText style={styles.infoValue}>{route.crossingInfo}</ThemedText>
                    </View>
                    <View style={styles.infoLine}>
                      <ThemedText style={styles.infoLabel}>Accessibility:</ThemedText>
                      <ThemedText style={styles.infoValue}>{route.accessibility}</ThemedText>
                    </View>

                    {route.hazardsList.length > 0 && (
                      <View style={styles.hazardsSubContainer}>
                        <ThemedText style={styles.hazardsLabel}>Reported Obstacles:</ThemedText>
                        {route.hazardsList.map((hazard, index) => (
                          <ThemedText key={index} style={styles.hazardItemText}>
                            {hazard}
                          </ThemedText>
                        ))}
                      </View>
                    )}
                    
                    <Pressable style={styles.confirmRouteButton}>
                      <ThemedText style={styles.confirmButtonText}>Confirm and Start Guidance</ThemedText>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {Platform.OS === 'web' && <WebBadge />}
      </ThemedView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    width: '100%',
    paddingTop: Spacing.four, // Adds consistent structural spacing for non-Android platforms (like iOS stack frames)
  },
  titleContainer: {
    gap: Spacing.one,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '900',
  },
  centerText: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.9,
  },
  routesListWrapper: {
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  routeCard: {
    borderWidth: 1.5,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  routeCardSelected: {
    borderColor: '#3498db',
    shadowColor: '#3498db',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routeNameWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  routeNameText: {
    fontSize: 18,
    fontWeight: '700',
  },
  accessibleBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.8,
  },
  ribbonTag: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.one,
  },
  ribbonTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricsGrid: {
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
paddingVertical: Spacing.one,
},
metricItem: {
flexDirection: 'row',
alignItems: 'center',
gap: Spacing.two,
},
metricTextBold: {
fontSize: 15,
fontWeight: '600',
},
detailPane: {
borderTopWidth: 1,
paddingTop: Spacing.three,
gap: Spacing.two,
marginTop: Spacing.one,
},
infoLine: {
flexDirection: 'column',
gap: 2,
},
infoLabel: {
fontSize: 12,
fontWeight: '700',
textTransform: 'uppercase',
opacity: 0.5,
},
infoValue: {
fontSize: 14,
lineHeight: 18,
},
hazardsSubContainer: {
marginTop: Spacing.two,
backgroundColor: 'rgba(231, 76, 60, 0.05)',
padding: Spacing.three,
borderRadius: Spacing.two,
gap: Spacing.one,
},
hazardsLabel: {
fontSize: 12,
fontWeight: '700',
color: '#e74c3c',
textTransform: 'uppercase',
marginBottom: 2,
},
hazardItemText: {
fontSize: 13,
color: '#c0392b',
fontWeight: '500',
},
confirmRouteButton: {
width: '100%',
height: 44,
backgroundColor: '#3498db',
borderRadius: Spacing.three,
justifyContent: 'center',
alignItems: 'center',
marginTop: Spacing.three,
},
confirmButtonText: {
color: '#ffffff',
fontSize: 15,
fontWeight: '700',
},
});
