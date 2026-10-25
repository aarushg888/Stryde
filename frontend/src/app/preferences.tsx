import { api } from "@/api/api";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { MaterialIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type RoutingMode = "standard" | "wheelchair";

interface Message {
  id: string;
  text: string;
  sender: "user" | "ai";
}

type Prefs = {
  routingMode: RoutingMode;
  preferSidewalks: boolean;
  wellLitOnly: boolean;
  lowTraffic: boolean;
  avoidObstacles: boolean;
};

const DEFAULT_PREFS: Prefs = {
  routingMode: "standard",
  preferSidewalks: true,
  wellLitOnly: false,
  lowTraffic: false,
  avoidObstacles: true,
};

const FLAG_META = {
  preferSidewalks: {
    title: "Prefer sidewalks",
    desc: "Skip streets without dedicated walkways",
    icon: "directions-walk" as const,
  },
  avoidObstacles: {
    title: "Protected crossings",
    desc: "Cross at signals and marked crosswalks",
    icon: "traffic" as const,
  },
  wellLitOnly: {
    title: "Well-lit streets",
    desc: "Brighter paths for evening walks",
    icon: "lightbulb" as const,
  },
  lowTraffic: {
    title: "Low-traffic streets",
    desc: "Avoid high-speed arterials and exhaust",
    icon: "volume-off" as const,
  },
} as const;

export default function PreferencesScreen() {
  // User preference state management hooks
  const [routingMode, setRoutingMode] = useState<RoutingMode>(
    DEFAULT_PREFS.routingMode,
  );
  const [preferSidewalks, setPreferSidewalks] = useState(
    DEFAULT_PREFS.preferSidewalks,
  );
  const [wellLitOnly, setWellLitOnly] = useState(DEFAULT_PREFS.wellLitOnly);
  const [lowTraffic, setLowTraffic] = useState(DEFAULT_PREFS.lowTraffic);
  const [avoidObstacles, setAvoidObstacles] = useState(
    DEFAULT_PREFS.avoidObstacles,
  );
  const [saveState, setSaveState] = useState<"loading" | "idle" | "saved" | "error">(
    "loading",
  );

  // Persistence: hydrate from the backend profile, then push every change.
  const hydratedRef = useRef(false);
  useEffect(() => {
    api
      .getPreferences()
      .then((saved) => {
        if (typeof saved.routingMode === "string") {
          setRoutingMode(saved.routingMode === "wheelchair" ? "wheelchair" : "standard");
        }
        if (typeof saved.preferSidewalks === "boolean") setPreferSidewalks(saved.preferSidewalks);
        if (typeof saved.wellLitOnly === "boolean") setWellLitOnly(saved.wellLitOnly);
        if (typeof saved.lowTraffic === "boolean") setLowTraffic(saved.lowTraffic);
        if (typeof saved.avoidObstacles === "boolean") setAvoidObstacles(saved.avoidObstacles);
      })
      .catch(() => {
        /* first run or backend offline — defaults are fine */
      })
      .finally(() => {
        hydratedRef.current = true;
        setSaveState("idle");
      });
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    setSaveState("idle");
    const t = setTimeout(() => {
      const prefs: Prefs = {
        routingMode,
        preferSidewalks,
        wellLitOnly,
        lowTraffic,
        avoidObstacles,
      };
      api
        .savePreferences(prefs)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 550);
    return () => clearTimeout(t);
  }, [routingMode, preferSidewalks, wellLitOnly, lowTraffic, avoidObstacles]);

  // Route assistant (rules-based, no external LLM keys needed)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hi! I can help you tune your route settings. Try: “I use a wheelchair” or “make my walks calmer”.",
      sender: "ai",
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
      const { reply, patch } = await api.chat({
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

      // The assistant can directly apply settings it mentioned.
      if (patch && typeof patch === "object") {
        const p = patch as Record<string, unknown>;
        if (p.routingMode === "wheelchair") setRoutingMode("wheelchair");
        if (p.routingMode === "standard") setRoutingMode("standard");
        if (typeof p.preferSidewalks === "boolean") setPreferSidewalks(p.preferSidewalks);
        if (typeof p.wellLitOnly === "boolean") setWellLitOnly(p.wellLitOnly);
        if (typeof p.lowTraffic === "boolean") setLowTraffic(p.lowTraffic);
        if (typeof p.avoidObstacles === "boolean") setAvoidObstacles(p.avoidObstacles);
      }
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

  const flags = {
    preferSidewalks,
    avoidObstacles,
    wellLitOnly,
    lowTraffic,
  } as const;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <ThemedText type="title" style={styles.title}>
              Preferences
            </ThemedText>
            <ThemedText style={styles.subtitle}>
              Tell Stryde how you move — routes are re-scored to match.
            </ThemedText>
          </View>

          {/* Mode selector */}
          <View style={styles.card}>
            <ThemedText style={styles.cardLabel}>How do you walk?</ThemedText>
            <View style={styles.modeGrid}>
              {(
                [
                  {
                    id: "standard",
                    label: "Standard walking",
                    icon: "directions-walk" as const,
                    desc: "Full network, normal speeds",
                  },
                  {
                    id: "wheelchair",
                    label: "Wheelchair / accessible",
                    icon: "accessible" as const,
                    desc: "Avoids curbs, stairs, steep grades",
                  },
                ] as const
              ).map((opt) => {
                const selected = routingMode === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.modeCard,
                      selected && {
                        borderColor: "#22c55e",
                        backgroundColor: "rgba(34,197,94,0.12)",
                      },
                    ]}
                    onPress={() => setRoutingMode(opt.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.modeIconWrap}>
                      <MaterialIcons
                        name={opt.icon}
                        size={20}
                        color={selected ? "#22c55e" : "#94a3b8"}
                      />
                    </View>
                    <ThemedText
                      style={[
                        styles.modeLabel,
                        selected && { color: "#4ade80" },
                      ]}
                    >
                      {opt.label}
                    </ThemedText>
                    <ThemedText style={styles.modeDesc}>{opt.desc}</ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Safety flags */}
          <View style={styles.card}>
            <View style={styles.cardHeadRow}>
              <ThemedText style={styles.cardLabel}>Safety priorities</ThemedText>
              {saveState !== "loading" ? (
                <View
                  style={[
                    styles.savedChip,
                    saveState === "saved" && styles.savedChipOn,
                    saveState === "error" && styles.savedChipErr,
                  ]}
                >
                  {saveState === "saved" ? (
                    <>
                      <MaterialIcons name="check-circle" size={13} color="#4ade80" />
                      <ThemedText style={styles.savedText}>Saved</ThemedText>
                    </>
                  ) : saveState === "error" ? (
                    <>
                      <MaterialIcons name="wifi-off" size={13} color="#f87171" />
                      <ThemedText style={[styles.savedText, { color: "#f87171" }]}>
                        Offline
                      </ThemedText>
                    </>
                  ) : (
                    <ActivityIndicator size="small" color="#94a3b8" />
                  )}
                </View>
              ) : null}
            </View>
            {(Object.keys(FLAG_META) as (keyof typeof FLAG_META)[]).map((key) => {
              const meta = FLAG_META[key];
              const on = flags[key];
              return (
                <View
                  key={key}
                  style={[styles.flagRow, on && styles.flagRowOn]}
                >
                  <View
                    style={[
                      styles.flagIcon,
                      on && { backgroundColor: "rgba(34,197,94,0.14)" },
                    ]}
                  >
                    <MaterialIcons
                      name={meta.icon}
                      size={18}
                      color={on ? "#22c55e" : "#64748b"}
                    />
                  </View>
                  <View style={styles.flagTextWrap}>
                    <ThemedText style={styles.flagTitle} numberOfLines={1}>
                      {meta.title}
                    </ThemedText>
                    <ThemedText style={styles.flagDesc} numberOfLines={1}>
                      {meta.desc}
                    </ThemedText>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={(v) => {
                      if (key === "preferSidewalks") setPreferSidewalks(v);
                      else if (key === "avoidObstacles") setAvoidObstacles(v);
                      else if (key === "wellLitOnly") setWellLitOnly(v);
                      else setLowTraffic(v);
                    }}
                    trackColor={{ false: "rgba(148,163,184,0.3)", true: "#22c55e" }}
                    thumbColor="#fff"
                  />
                </View>
              );
            })}
            <ThemedText style={styles.modeSummary}>
              {routingMode === "wheelchair" ? "Wheelchair mode" : "Standard mode"} ·{" "}
              {Object.values(flags).filter(Boolean).length} of 4 flags on — every
              change is saved automatically.
            </ThemedText>
          </View>

          {/* Route assistant */}
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={styles.card}>
              <View style={styles.cardHeadRow}>
                <ThemedText style={styles.cardLabel}>Route assistant</ThemedText>
                <MaterialIcons name="smart-toy" size={16} color="#94a3b8" />
              </View>
              <View style={styles.chatWindow}>
                {messages.map((msg) => (
                  <View
                    key={msg.id}
                    style={[
                      styles.messageBubble,
                      msg.sender === "user" ? styles.userBubble : styles.aiBubble,
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.messageText,
                        msg.sender === "user" && { color: "#0c1210" },
                      ]}
                    >
                      {msg.text}
                    </ThemedText>
                  </View>
                ))}
                {isLoading ? (
                  <ActivityIndicator
                    size="small"
                    color="#22c55e"
                    style={{ alignSelf: "flex-start", marginLeft: Spacing.one }}
                  />
                ) : null}
              </View>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Ask about your route settings…"
                  placeholderTextColor="#5b6b7b"
                  value={inputText}
                  onChangeText={setInputText}
                  editable={!isLoading}
                  onSubmitEditing={() => void handleSendMessage()}
                />
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={() => void handleSendMessage()}
                  disabled={isLoading}
                >
                  <MaterialIcons name="send" size={17} color="#0c1210" />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    paddingTop: Platform.OS === 'web' ? 84 : Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  header: { gap: Spacing.one, marginBottom: Spacing.one },
  title: { fontSize: 26, fontWeight: "900" },
  subtitle: { fontSize: 14, opacity: 0.65, lineHeight: 20 },
  card: {
    backgroundColor: "rgba(148,163,184,0.08)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLabel: {
    fontSize: 12.5,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    opacity: 0.75,
  },
  modeGrid: { flexDirection: "row", gap: Spacing.two },
  modeCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    backgroundColor: "rgba(148,163,184,0.05)",
    padding: Spacing.two + 2,
    gap: 3,
  },
  modeIconWrap: { marginBottom: 2 },
  modeLabel: { fontSize: 13, fontWeight: "800", color: "#e2e8f0" },
  modeDesc: { fontSize: 11, opacity: 0.55 },
  savedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(148,163,184,0.14)",
  },
  savedChipOn: { backgroundColor: "rgba(34,197,94,0.12)" },
  savedChipErr: { backgroundColor: "rgba(239,68,68,0.12)" },
  savedText: { fontSize: 11, fontWeight: "700", color: "#4ade80" },
  flagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    backgroundColor: "rgba(148,163,184,0.04)",
    padding: Spacing.two + 2,
  },
  flagRowOn: { borderColor: "rgba(34,197,94,0.45)" },
  flagIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(148,163,184,0.12)",
  },
  flagTextWrap: { flex: 1 },
  flagTitle: { fontSize: 14, fontWeight: "700", color: "#e2e8f0" },
  flagDesc: { fontSize: 11.5, opacity: 0.5, marginTop: 1 },
  modeSummary: { fontSize: 11.5, opacity: 0.55, marginTop: Spacing.one },
  chatWindow: { gap: Spacing.two },
  messageBubble: {
    maxWidth: "88%",
    padding: Spacing.two + 2,
    borderRadius: 14,
  },
  userBubble: {
    backgroundColor: "#a3e635",
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    backgroundColor: "rgba(148,163,184,0.12)",
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  messageText: { fontSize: 13.5, lineHeight: 19 },
  inputContainer: { flexDirection: "row", gap: Spacing.two },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    height: 42,
    fontSize: 14,
    color: "#e2e8f0",
    backgroundColor: "rgba(148,163,184,0.05)",
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#a3e635",
    alignItems: "center",
    justifyContent: "center",
  },
});
