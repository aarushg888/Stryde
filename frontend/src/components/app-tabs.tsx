import { Tabs } from 'expo-router';
import { useColorScheme, Image } from 'react-native';
import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false, // Hides the default top action header bar
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.backgroundElement,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 0, // Keeps bottom menu transition flat and clean
        },
      }}
    >
      {/* 1. Map Main Screen */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Map',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/home.png')}
              style={{ width: 24, height: 24, tintColor: color }}
              resizeMode="contain"
            />
          ),
        }}
      />

      {/* 2. Routes Management */}
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Routes',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/explore.png')}
              style={{ width: 24, height: 24, tintColor: color }}
              resizeMode="contain"
            />
          ),
        }}
      />

      {/* 3. Hazards Safety Screen */}
      <Tabs.Screen
        name="hazards"
        options={{
          title: 'Hazards',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/explore.png')}
              style={{ width: 24, height: 24, tintColor: color }}
              resizeMode="contain"
            />
          ),
        }}
      />

      {/* 4. User System Preferences */}
      <Tabs.Screen
        name="preferences"
        options={{
          title: 'Preferences',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/explore.png')}
              style={{ width: 24, height: 24, tintColor: color }}
              resizeMode="contain"
            />
          ),
        }}
      />
    </Tabs>
  );
}
