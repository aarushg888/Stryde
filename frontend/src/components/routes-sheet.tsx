import { MaterialIcons } from "@expo/vector-icons";
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type RouteOption = {
  label: string;
  km: number;
  minutes: number;
};

type Props = {
  visible: boolean;
  options: RouteOption[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
};

const GREEN = "#2ecc71";

export function RoutesSheet({
  visible,
  options,
  selectedIndex,
  onSelect,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* Transparent backdrop: map stays visible above the sheet; tap to dismiss. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>Choose a route</Text>

          {options.map((option, index) => {
            const selected = index === selectedIndex;
            return (
              <TouchableOpacity
                key={index}
                activeOpacity={0.8}
                onPress={() => onSelect(index)}
                style={[styles.row, selected && styles.rowSelected]}
              >
                <MaterialIcons
                  name="directions-walk"
                  size={24}
                  color={selected ? GREEN : "#aaaaaa"}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{option.label}</Text>
                  <Text style={styles.rowMeta}>{option.km.toFixed(2)} km</Text>
                </View>
                <Text style={styles.rowTime}>{option.minutes} min</Text>
                <MaterialIcons
                  name={
                    selected ? "radio-button-checked" : "radio-button-unchecked"
                  }
                  size={22}
                  color={selected ? GREEN : "#666666"}
                />
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity style={styles.confirm} onPress={onClose}>
            <Text style={styles.confirmText}>Select route</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#242424",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
    elevation: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#555555",
    marginBottom: 6,
  },
  title: { color: "#ffffff", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    backgroundColor: "#2c2c2c",
  },
  rowSelected: {
    borderColor: GREEN,
    backgroundColor: "rgba(46, 204, 113, 0.1)",
  },
  rowText: { flex: 1 },
  rowLabel: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  rowMeta: { color: "#aaaaaa", fontSize: 12, marginTop: 2 },
  rowTime: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  confirm: {
    backgroundColor: GREEN,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 6,
  },
  confirmText: { color: "#ffffff", fontSize: 17, fontWeight: "700" },
});
