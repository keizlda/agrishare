import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../components/ScreenHeader";
import Avatar from "../components/Avatar";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";
import { useTabBarHeight } from "../hooks/useTabBarHeight";

const ACCOUNT_ITEMS = [{ icon: "key-outline", label: "Change Password" }];

export default function MoreScreen({ navigation }) {
  const { farmer, logout } = useAuth();
  const tabBarHeight = useTabBarHeight();

  const HANDLERS = {
    "Change Password": () => navigation.navigate("ChangePassword"),
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="More" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight }]}>
        <TouchableOpacity style={styles.profileRow} onPress={() => navigation.navigate("Profile")}>
          <Avatar uri={farmer?.avatarUrl} size={40} key={farmer?.avatarUrl} />
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{farmer?.firstName} {farmer?.lastName}</Text>
            <Text style={styles.profileSub}>Farmer · {farmer?.farmerId}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.primaryDark} />
        </TouchableOpacity>

        <Section title="Account" items={ACCOUNT_ITEMS.map((item) => ({ ...item, onPress: HANDLERS[item.label] }))} />

        <TouchableOpacity style={styles.logoutRow} onPress={logout}>
          <Ionicons name="log-out-outline" size={16} color={colors.red} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
        <Text style={styles.version}>App Version 1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function Section({ title, items }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {items.map((item, i) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.itemRow, i === items.length - 1 && { borderBottomWidth: 0 }]}
            onPress={item.onPress}
            disabled={!item.onPress}
          >
            <Ionicons name={item.icon} size={16} color={colors.textMuted} style={{ width: 22 }} />
            <Text style={styles.itemLabel}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={14} color="#c3ccc5" />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 20,
  },
  profileName: { fontSize: 13.5, fontWeight: "700", color: colors.text },
  profileSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },

  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.textMuted, marginBottom: 6, textTransform: "uppercase" },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemLabel: { flex: 1, fontSize: 12.5, color: colors.text },

  logoutRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
  logoutText: { color: colors.red, fontWeight: "700", fontSize: 13 },
  version: { textAlign: "center", fontSize: 10.5, color: "#a8b3ab" },
});
