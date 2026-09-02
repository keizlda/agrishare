import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Info } from "lucide-react-native";
import { colors, radius } from "../theme";

export default function ReminderBanner({ text, actionLabel, onPress }) {
  return (
    <View style={styles.wrap}>
      <Info size={18} color={colors.primaryDark} />
      <Text style={styles.text}>{text}</Text>
      {actionLabel && (
        <TouchableOpacity onPress={onPress}>
          <Text style={styles.action}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 8,
  },
  text: {
    flex: 1,
    fontSize: 11.5,
    color: colors.primaryDark,
  },
  action: {
    fontSize: 11.5,
    fontWeight: "700",
    color: colors.primaryDark,
    textDecorationLine: "underline",
  },
});
