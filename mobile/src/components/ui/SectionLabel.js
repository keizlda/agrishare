import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../../theme";

// Matches web's .pr-section-label / .agri-detail-section-title: small
// uppercase, letter-spaced, primary green, with a hairline rule beneath.
export default function SectionLabel({ children, style }) {
  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: spacing.md,
  },
  text: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: typography.letterSpacingWide,
    textTransform: "uppercase",
    color: colors.primary,
  },
});
