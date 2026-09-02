import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Check } from "lucide-react-native";
import ScreenHeader from "../components/ScreenHeader";
import { colors, radius, shadows, spacing } from "../theme";

const STORAGE_KEY = "agrishare_language";

// Only English actually has strings today — no translation files exist for
// Filipino yet, so it's shown but disabled rather than faked as available.
const LANGUAGES = [
  { code: "en", label: "English", available: true },
  { code: "fil", label: "Filipino", available: false },
];

export default function LanguageScreen({ navigation }) {
  const [selected, setSelected] = useState("en");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => v && setSelected(v));
  }, []);

  function select(code) {
    setSelected(code);
    AsyncStorage.setItem(STORAGE_KEY, code).catch(() => {});
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Language" onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <View style={styles.card}>
          {LANGUAGES.map((lang, i) => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.row, i === LANGUAGES.length - 1 && { borderBottomWidth: 0 }, !lang.available && styles.rowDisabled]}
              onPress={() => lang.available && select(lang.code)}
              disabled={!lang.available}
            >
              <Text style={[styles.label, !lang.available && styles.labelDisabled]}>{lang.label}</Text>
              {!lang.available && <Text style={styles.soon}>Coming soon</Text>}
              {lang.available && selected === lang.code && <Check size={18} color={colors.primary} />}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    ...shadows.card,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowDisabled: { opacity: 0.55 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text },
  labelDisabled: { color: colors.textMuted },
  soon: { fontSize: 10.5, color: colors.textFaint, fontStyle: "italic" },
});
