import { Colors } from "@/constants/theme";
import { Tabs } from "expo-router";
import { Image, useColorScheme } from "react-native";

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === "dark" ? "dark" : "light"];

  return (
    <Tabs
      screenOptions={{
        headerShown: false, // Hides the default top action header bar
        tabBarActiveTintColor: "#3498db",
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: "#1b1c1f",
          // marginTop: 5,
          paddingTop: 5, // Keeps bottom menu transition flat and clean
        },
      }}
    >
      {/* 1. Map Main Screen */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Map",
          tabBarIcon: ({ color }) => (
            <Image
              source={require("@/assets/images/tabIcons/home.png")}
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
          title: "Routes",
          tabBarIcon: ({ color }) => (
            <Image
              source={require("@/assets/images/tabIcons/explore.png")}
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
          title: "Hazards",
          tabBarIcon: ({ color }) => (
            <Image
              source={require("@/assets/images/tabIcons/explore.png")}
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
          title: "Preferences",
          tabBarIcon: ({ color }) => (
            <Image
              source={require("@/assets/images/tabIcons/explore.png")}
              style={{ width: 24, height: 24, tintColor: color }}
              resizeMode="contain"
            />
          ),
        }}
      />
    </Tabs>
  );
}
