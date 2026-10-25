import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Pressable, View, StyleSheet } from 'react-native';

import { Spacing } from '@/constants/theme';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="home" href="/" asChild>
            <TabButton>Map</TabButton>
          </TabTrigger>
          <TabTrigger name="hazards" href="/hazards" asChild>
            <TabButton>Hazards</TabButton>
          </TabTrigger>
          <TabTrigger name="preferences" href="/preferences" asChild>
            <TabButton>Preferences</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  // expo-router/ui asChild forwards host props whose ref typing doesn't match
  // react-native-web's Pressable exactly; the runtime behavior is identical.
  const pressableProps = props as unknown as Omit<TabTriggerSlotProps, 'ref'>;
  return (
    <Pressable {...pressableProps} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        <ThemedText type="small" themeColor={isFocused ? 'text' : 'textSecondary'}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  // Subtab chips now live inside the map drawer ("Route settings · Hazards ·
  // Preferences"), so the old floating web tab pill is hidden — the map stays
  // full-screen with nothing drawn over it. Triggers stay registered with the
  // router so deep links still resolve.
  return (
    <View
      {...props}
      style={[styles.tabListContainer, styles.tabListHidden]}
      pointerEvents="none"
    >
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    top:20
  },
  tabListHidden: {
    opacity: 0,
    height: 0,
    padding: 0,
    overflow: 'hidden',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  externalPressable: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.one,
    marginLeft: Spacing.three,
  },
});
