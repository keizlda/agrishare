import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../../theme";

// Centered icon + gray message — same tone as web's empty-state copy.
export default function EmptyState({ icon: Icon, message, style }) {
  return (
    <View style={[styles.wrap, style]}>
      {Icon && <Icon size={28} color={colors.textFaint} />}
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  text: { fontSize: typography.body.fontSize, color: colors.textMuted, textAlign: "center" },
});
