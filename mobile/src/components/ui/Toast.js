import { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text } from "react-native";
import { CheckCircle2, XCircle } from "lucide-react-native";
import { colors, radii, shadow, spacing, typography } from "../../theme";

// Matches web's .agri-toast exactly: dark surface (colors.text), white copy,
// primary-green success icon / redOnDark error icon, same shadow. Web
// auto-dismisses after 3s (Toast.jsx:6) — mirrored here via onDone.
// action: { label, onPress } adds a button (e.g. "Undo"); it stays 5s then.
// bottom: lift it above a tab bar.
export default function Toast({ visible, message, tone = "success", onDone, action, bottom }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The native driver exists only on the phone (the web preview warns).
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 200, useNativeDriver: Platform.OS !== "web" }).start();
    if (!visible) return;
    const timer = setTimeout(() => onDone?.(), action ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [visible, message]);

  if (!visible) return null;
  const Icon = tone === "error" ? XCircle : CheckCircle2;
  const iconColor = tone === "error" ? colors.redOnDark : colors.primary;

  return (
    <Animated.View style={[styles.toast, bottom != null && { bottom }, { opacity, pointerEvents: action ? "box-none" : "none" }]}>
      <Icon size={16} color={iconColor} />
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
      {!!action && (
        <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button" style={styles.action}>
          <Text style={styles.actionText}>{action.label}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    bottom: spacing.xl,
    left: spacing.base,
    right: spacing.base,
    backgroundColor: colors.text,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    ...shadow({ color: "#000", y: 10, opacity: 0.25, radius: 30, elevation: 10 }),
  },
  text: { color: "#fff", flex: 1, fontSize: typography.label.fontSize, fontWeight: "600" },
  action: { paddingVertical: 4, paddingHorizontal: 8 },
  actionText: { color: colors.primary, fontSize: typography.label.fontSize, fontWeight: "800" },
});
