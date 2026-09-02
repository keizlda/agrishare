import { StyleSheet, View } from "react-native";
import { colors, radii, shadows, spacing } from "../../theme";

// Matches web's .agri-card: white surface, medium radius, the same subtle
// two-layer shadow (collapsed to one for RN), 1px hairline border.
export default function Card({ children, style, padded = true }) {
  return <View style={[styles.card, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    ...shadows.card,
  },
  padded: { padding: spacing.md },
});
