import { ScrollView, StyleSheet, Text, View } from "react-native";
import ScreenHeader from "../components/ScreenHeader";
import { colors, radius, shadows, spacing } from "../theme";

// Shared shell for every static-content More-menu screen (Terms, Privacy,
// About, FAQs, Help Center) — one file instead of five near-identical ones.
// route.params: { title, sections: [{ heading, body }] }
export default function InfoScreen({ navigation, route }) {
  const { title, sections } = route.params;
  return (
    <View style={styles.screen}>
      <ScreenHeader title={title} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {sections.map((s) => (
          <View key={s.heading} style={styles.card}>
            <Text style={styles.heading}>{s.heading}</Text>
            <Text style={styles.body}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.base,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  heading: { fontSize: 13.5, fontWeight: "700", color: colors.text, marginBottom: 6 },
  body: { fontSize: 12.5, color: colors.textMuted, lineHeight: 19 },
});
