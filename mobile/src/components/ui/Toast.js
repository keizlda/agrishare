import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { CheckCircle2, XCircle } from "lucide-react-native";
import { colors, radii, spacing, typography } from "../../theme";

// Matches web's .agri-toast exactly: dark surface (colors.text), white copy,
// primary-green success icon / redOnDark error icon, same shadow. Web
// auto-dismisses after 3s (Toast.jsx:6) — mirrored here via onDone.
export default function Toast({ visible, message, tone = "success", onDone }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 200, useNativeDriver: true }).start();
    if (!visible) return;
    const timer = setTimeout(() => onDone?.(), 3000);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  const Icon = tone === "error" ? XCircle : CheckCircle2;
  const iconColor = tone === "error" ? colors.redOnDark : colors.primary;

  return (
    <Animated.View style={[styles.toast, { opacity }]} pointerEvents="none">
      <Icon size={16} color={iconColor} />
      <Text style={styles.text} numberOfLines={2}>
        {message}
      </Text>
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 10,
  },
  text: { color: "#fff", flex: 1, fontSize: typography.label.fontSize, fontWeight: "600" },
});
