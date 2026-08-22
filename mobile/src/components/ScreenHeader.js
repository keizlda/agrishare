import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme";

export default function ScreenHeader({ title, showLogo, onBellPress }) {
  return (
    <View style={styles.row}>
      {showLogo ? (
        <View style={styles.logoRow}>
          <Ionicons name="leaf" size={18} color={colors.primary} />
          <Text style={styles.logo}>
            AGRI<Text style={{ color: colors.primary }}>SHARE</Text>
          </Text>
        </View>
      ) : (
        <Text style={styles.title}>{title}</Text>
      )}
      {onBellPress && (
        <TouchableOpacity onPress={onBellPress} style={styles.bellBtn}>
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
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
    paddingTop: 10,
    paddingBottom: 14,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  logo: { fontSize: 17, fontWeight: "800", color: colors.primaryDarker },
  title: { fontSize: 20, fontWeight: "700", color: colors.text },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 7,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.red,
    borderWidth: 1,
    borderColor: "#fff",
  },
});
