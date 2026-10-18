import { api } from "@/api/api";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors, Spacing } from "@/constants/theme";
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type RoutingMode = "standard" | "wheelchair";

interface Message {
  id: string;
  text: string;
  sender: "user" | "ai";
}

export default function PreferencesScreen() {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const colors = Colors[isDark ? "dark" : "light"];

  // User Preference State Management Hooks
  const [routingMode, setRoutingMode] = useState<RoutingMode>("standard");
  const [preferSidewalks, setPreferSidewalks] = useState(true);
  const [wellLitOnly, setWellLitOnly] = useState(false);
  const [lowTraffic, setLowTraffic] = useState(false);
  const [avoidObstacles, setAvoidObstacles] = useState(true);

  // Chatbot State Management Hooks
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hello! How can I help you customize your travel preferences today?",
      sender: "ai",
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Groq API Call Handler
  const handleSendMessage = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText.trim(),
      sender: "user",
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText("");
    setIsLoading(true);

    try {
      const { reply } = await api.chat({
        message: userMessage.text,
        routingMode,
        preferSidewalks,
        wellLitOnly,
        lowTraffic,
        avoidObstacles,
      });

      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), text: reply, sender: "ai" },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          text:
            error instanceof Error
              ? error.message
              : "Could not reach the route assistant. Please try again.",
          sender: "ai",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header Block */}
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>
              Preferences
            </ThemedText>
            <ThemedText style={styles.subtitle}>
              Customize your walking parameters to generate the safest
              pedestrian routes.
            </ThemedText>
          </View>

          {/* Section 1: Accessibility Base Mode Selector */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>
              1. Routing Access Mode
            </ThemedText>
            <View
              style={[
                styles.toggleGroupContainer,
                { borderColor: colors.backgroundElement },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  routingMode === "standard" && { backgroundColor: "#3498db" },
                ]}
                onPress={() => setRoutingMode("standard")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[
                    styles.toggleButtonText,
                    routingMode === "standard" && styles.textActive,
                  ]}
                >
                  Standard walking
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  routingMode === "wheelchair" && {
                    backgroundColor: "#3498db",
                  },
                ]}
                onPress={() => setRoutingMode("wheelchair")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[
                    styles.toggleButtonText,
                    routingMode === "wheelchair" && styles.textActive,
                  ]}
                >
                  Wheelchair / accessible
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {/* Section 2: Infrastructure Safety Flags */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>
              2. Path & Infrastructure Settings
            </ThemedText>
            <View
              style={[
                styles.settingRow,
                { borderBottomWidth: 1, borderColor: colors.backgroundElement },
              ]}
            >
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>
                  Prioritize Sidewalks
                </ThemedText>
                <ThemedText style={styles.settingDescription}>
                  Avoid paths missing dedicated pedestrian walkways.
                </ThemedText>
              </View>
              <Switch
                value={preferSidewalks}
                onValueChange={setPreferSidewalks}
                trackColor={{ false: "#767577", true: "#2ecc71" }}
                thumbColor="#ffffff"
              />
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>
                  Protected Crossings Only
                </ThemedText>
                <ThemedText style={styles.settingDescription}>
                  Route through marked crosswalks and traffic signals.
                </ThemedText>
              </View>
              <Switch
                value={avoidObstacles}
                onValueChange={setAvoidObstacles}
                trackColor={{ false: "#767577", true: "#2ecc71" }}
                thumbColor="#ffffff"
              />
            </View>
          </View>

          {/* Section 3: Environmental Safety Filters */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>
              3. Environmental Conditions
            </ThemedText>
            <View
              style={[
                styles.settingRow,
                { borderBottomWidth: 1, borderColor: colors.backgroundElement },
              ]}
            >
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>
                  Enhanced Safety Lighting
                </ThemedText>
                <ThemedText style={styles.settingDescription}>
                  Prioritize well-lit streets during evening strolls.
                </ThemedText>
              </View>
              <Switch
                value={wellLitOnly}
                onValueChange={setWellLitOnly}
                trackColor={{ false: "#767577", true: "#2ecc71" }}
                thumbColor="#ffffff"
              />
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingTextContainer}>
                <ThemedText style={styles.settingTitle}>
                  Low Traffic Exposure
                </ThemedText>
                <ThemedText style={styles.settingDescription}>
                  Steer away from high-speed arterial roadways and exhaust.
                </ThemedText>
              </View>
              <Switch
                value={lowTraffic}
                onValueChange={setLowTraffic}
                trackColor={{ false: "#767577", true: "#2ecc71" }}
                thumbColor="#ffffff"
              />
            </View>
          </View>

          {/* Configuration State Tracker Display */}
          <View
            style={[
              styles.statusFeedbackBox,
              { backgroundColor: colors.backgroundElement },
            ]}
          >
            <ThemedText style={styles.statusBoxText}>
              Stryde safety filters configured for{" "}
              <ThemedText style={{ fontWeight: "700" }}>
                {routingMode === "standard"
                  ? "Standard Pedestrian"
                  : "Wheelchair Access"}
              </ThemedText>{" "}
              metrics.
            </ThemedText>
          </View>

          {/* --- NEW SECTION: AI Chatbot Integration --- */}
          <View
            style={[
              styles.chatSection,
              { borderColor: colors.backgroundElement },
            ]}
          >
            <ThemedText style={styles.sectionLabel}>
              Stryde Route Assistant
            </ThemedText>

            {/* Embedded inner messages area */}
            <View style={styles.chatWindow}>
              {messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.messageBubble,
                    msg.sender === "user"
                      ? styles.userBubble
                      : [
                          styles.aiBubble,
                          { backgroundColor: colors.backgroundElement },
                        ],
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.messageText,
                      msg.sender === "user" && { color: "#fff" },
                    ]}
                  >
                    {msg.text}
                  </ThemedText>
                </View>
              ))}
            </View>

            {/* Input Bar Layout */}
            <View style={styles.inputContainer}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: isDark ? "#fff" : "#000",
                    borderColor: colors.backgroundElement,
                  },
                ]}
                placeholder="Ask about your route safety..."
                placeholderTextColor={isDark ? "#888" : "#aaa"}
                value={inputText}
                onChangeText={setInputText}
                editable={!isLoading}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  { backgroundColor: isLoading ? "#bdc3c7" : "#3498db" },
                ]}
                onPress={handleSendMessage}
                disabled={isLoading}
              >
                <ThemedText style={styles.sendButtonText}>
                  {isLoading ? "..." : "Send"}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor: "#F8FAFC",
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
    fontWeight: "900",
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
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    opacity: 0.8,
  },
  toggleGroupContainer: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: Spacing.three,
    overflow: "hidden",
    height: 46,
    width: "100%",
  },
  toggleButton: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.01)",
  },
  toggleButtonText: {
    fontSize: 13,
    fontWeight: "600",
  },
  textActive: {
    color: "#ffffff",
    fontWeight: "700",
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.three,
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: Spacing.four,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    opacity: 0.5,
    lineHeight: 16,
  },
  statusFeedbackBox: {
    width: "100%",
    padding: Spacing.three,
    borderRadius: Spacing.three,
    marginTop: Spacing.two,
  },
  statusBoxText: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    opacity: 0.8,
  },
  /* Chatbot Styling Rules */
  chatSection: {
    gap: Spacing.three,
    marginTop: Spacing.two,
    borderTopWidth: 1,
    paddingTop: Spacing.five,
  },
  chatWindow: {
    width: "100%",
    gap: Spacing.two,
  },
  messageBubble: {
    maxWidth: "85%",
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  userBubble: {
    backgroundColor: "#3498db",
    alignSelf: "flex-end",
    borderBottomRightRadius: 2,
  },
  aiBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 2,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  inputContainer: {
    flexDirection: "row",
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    height: 44,
    fontSize: 14,
  },
  sendButton: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    height: 44,
  },
  sendButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});
