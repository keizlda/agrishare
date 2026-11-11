import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { RotateCw, WifiOff } from "lucide-react-native";
import { colors, radius } from "../../theme";

// A plain message with Try again, shown where a screen's data couldn't load
// (no connection, server problem) — instead of an empty "nothing here yet"
// state that would look like the farmer has no records.
export default function ErrorBanner({ message, onRetry, style }) {
  return (
    <View style={[styles.box, style]} accessibilityRole="alert">
      <View style={styles.row}>
        <WifiOff size={18} color={colors.red} />
        <Text style={styles.text}>{message}</Text>
      </View>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={styles.button} accessibilityRole="button">
          <RotateCw size={14} color={colors.primaryDark} />
          <Text style={styles.buttonText}>Try again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.redBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#efc4c2",
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  // flex: 1 — the full width, not the measured text (see ProfileScreen Row).
  text: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 18 },
  button: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  buttonText: { fontSize: 13, fontWeight: "700", color: colors.primaryDark },
});
