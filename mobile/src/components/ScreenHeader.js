import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Bell, Sprout } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, sizes } from "../theme";

// White bg + bottom hairline, matching web's Topbar exactly (theme.css:60-66)
// — AGRISHARE wordmark in the same green, same weight/letter-spacing, same
// Sprout logo icon (Topbar.jsx:84).
//
// Owns the top safe-area inset itself (screens should NOT also pad for it)
// so its white background extends up behind the status bar/notch instead of
// leaving a gap in the screen's paler background above it — that gap and
// the header used to read as one washed-out block instead of a crisp header.
export default function ScreenHeader({ title, showLogo, onBellPress }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { paddingTop: insets.top + 6 }]}>
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
    // paddingTop is set inline above (insets.top + 6); this is just the
    // bottom half — enough to clear the 44px bell tap target from the
    // hairline without extra bulk.
    paddingBottom: 6,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { fontSize: 16, fontWeight: "800", color: colors.primaryDarker },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  bellBtn: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: sizes.minTouchTarget / 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
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
    borderColor: "#fff",
  },
});
