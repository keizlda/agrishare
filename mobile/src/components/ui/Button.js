import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, radii, sizes, typography } from "../../theme";

// Filled primary (matches .btn-agri-primary), outlined secondary, outlined
// destructive — same radius and label weight as web, with real pressed/
// disabled states since RN has no CSS :hover to lean on.
const VARIANTS = {
  primary: {
    bg: colors.primary,
    bgPressed: colors.primaryDark,
    border: colors.primary,
    borderPressed: colors.primaryDark,
    text: "#fff",
  },
  secondary: {
    bg: "transparent",
    bgPressed: colors.primarySoft,
    border: colors.primary,
    borderPressed: colors.primary,
    text: colors.primary,
  },
  destructive: {
    bg: "transparent",
    bgPressed: colors.redBg,
    border: colors.red,
    borderPressed: colors.red,
    text: colors.red,
  },
};

export default function Button({ label, onPress, variant = "primary", disabled, loading, icon: Icon, style }) {
  const v = VARIANTS[variant] ?? VARIANTS.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: pressed ? v.bgPressed : v.bg, borderColor: pressed ? v.borderPressed : v.border },
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} size="small" />
      ) : (
        <>
          {Icon && <Icon size={16} color={v.text} />}
          <Text style={[styles.label, { color: v.text }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: sizes.buttonHeight,
    minWidth: sizes.minTouchTarget,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    flexDirection: "row",
    gap: 8,
  },
  label: { fontSize: typography.label.fontSize, fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
