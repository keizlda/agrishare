import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ArrowLeft, Bell, Sprout } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, shadows, sizes } from "../theme";

// A sage band one step deeper than the page (colors.header vs colors.bg), so
// the header stands out without a white bar; same green wordmark and Sprout
// logo icon as web's Topbar.jsx.
//
// Owns the top safe-area inset itself (screens should NOT also pad for it).
export default function ScreenHeader({ title, showLogo, onBellPress, onBack }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { paddingTop: insets.top + 10 }]}>
      <View style={styles.leftRow}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <ArrowLeft size={18} color={colors.text} />
          </TouchableOpacity>
        )}
        {showLogo ? (
          <View style={styles.logoRow}>
            <Sprout size={18} color={colors.primary} />
            <Text style={styles.logo}>
              AGRI<Text style={{ color: colors.primary }}>SHARE</Text>
            </Text>
          </View>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}
      </View>
      {onBellPress && (
        <TouchableOpacity onPress={onBellPress} style={styles.bellBtn}>
          <Bell size={20} color={colors.text} />
          <View style={styles.dot} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    // paddingTop is set inline above (insets.top + 10).
    paddingBottom: 10,
    backgroundColor: colors.header,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  leftRow: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { fontSize: 16, fontWeight: "800", color: colors.primaryDarker },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  backBtn: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: sizes.minTouchTarget / 2,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  bellBtn: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: sizes.minTouchTarget / 2,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  dot: {
    position: "absolute",
    top: 11,
    right: 12,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.red,
    borderWidth: 1,
    borderColor: colors.card,
  },
});
