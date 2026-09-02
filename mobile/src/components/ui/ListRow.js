import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, spacing, typography } from "../../theme";

// Same hairline dividers, padding, and title/subtitle text hierarchy as
// web's tables and inbox rows (e.g. the Validation inbox row list).
export default function ListRow({ icon: Icon, title, subtitle, trailing, onPress, last, style }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper onPress={onPress} style={[styles.row, !last && styles.divider, style]} activeOpacity={0.7}>
      {Icon && (
        <View style={styles.iconWrap}>
          <Icon size={16} color={colors.primaryDark} />
        </View>
      )}
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, minHeight: 44 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  iconWrap: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  textWrap: { flex: 1 },
  title: { fontSize: typography.body.fontSize, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: typography.caption.fontSize, color: colors.textMuted, marginTop: 2 },
});
