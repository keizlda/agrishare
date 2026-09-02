import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadows } from "../theme";

const COLOR_MAP = {
  green: { bg: colors.primaryLight, fg: colors.primaryDark },
  blue: { bg: colors.blueBg, fg: colors.blue },
  red: { bg: colors.redBg, fg: colors.red },
  orange: { bg: colors.orangeBg, fg: colors.orange },
  purple: { bg: colors.purpleBg, fg: colors.purple },
};

export default function StatTile({ icon, label, value, color = "green" }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.green;
  return (
    <View style={styles.tile}>
      <View style={[styles.iconWrap, { backgroundColor: c.bg }]}>
        <Ionicons name={icon} size={16} color={c.fg} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexBasis: "48%",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 10,
    ...shadows.card,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  value: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.text,
  },
  label: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
});
