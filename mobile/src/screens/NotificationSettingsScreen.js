import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import ScreenHeader from "../components/ScreenHeader";
import { colors, radius, shadows, spacing } from "../theme";

const STORAGE_KEY = "agrishare_notification_prefs";

const OPTIONS = [
  { key: "announcements", label: "Announcements", sub: "New notices from the Municipal Agriculture Office" },
  { key: "distributions", label: "Distribution Schedules", sub: "Upcoming and ongoing distribution events" },
  { key: "requests", label: "Commodity Request Updates", sub: "When your request is forwarded, approved, or rejected" },
  { key: "validations", label: "Crop Validation Results", sub: "When a submission is validated or rejected" },
];

const DEFAULTS = { announcements: true, distributions: true, requests: true, validations: true };

export default function NotificationSettingsScreen({ navigation }) {
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setPrefs({ ...DEFAULTS, ...JSON.parse(raw) });
      })
      .finally(() => setLoaded(true));
  }, []);

  function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Notification Settings" onBack={() => navigation.goBack()} />
      <View style={styles.content}>
        <Text style={styles.note}>
          These control which notices appear in your Announcements inbox. Push alerts to your device aren't available
          yet — your choices here are saved and ready for when they are.
        </Text>
        <View style={styles.card}>
          {loaded &&
            OPTIONS.map((opt, i) => (
              <View key={opt.key} style={[styles.row, i === OPTIONS.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{opt.label}</Text>
                  <Text style={styles.sub}>{opt.sub}</Text>
                </View>
                <Switch
                  value={prefs[opt.key]}
                  onValueChange={() => toggle(opt.key)}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={prefs[opt.key] ? colors.primary : "#fff"}
                />
              </View>
            ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16 },
  note: { fontSize: 11.5, color: colors.textMuted, lineHeight: 16, marginBottom: spacing.base },
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
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  sub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
});
