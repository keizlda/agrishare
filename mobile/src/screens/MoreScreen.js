import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../components/ScreenHeader";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";

const ACCOUNT_ITEMS = [
  { icon: "person-outline", label: "My Information" },
  { icon: "key-outline", label: "Change Password" },
  { icon: "notifications-outline", label: "Notification Settings" },
  { icon: "phone-portrait-outline", label: "Linked Devices" },
  { icon: "globe-outline", label: "Language" },
];
const SUPPORT_ITEMS = [
  { icon: "help-circle-outline", label: "Help Center" },
  { icon: "call-outline", label: "Contact Support" },
  { icon: "document-text-outline", label: "FAQs" },
  { icon: "warning-outline", label: "Report an Issue" },
];
const OTHER_ITEMS = [
  { icon: "reader-outline", label: "Terms and Conditions" },
  { icon: "shield-checkmark-outline", label: "Privacy Policy" },
  { icon: "information-circle-outline", label: "About AGRISHARE" },
];

export default function MoreScreen({ navigation }) {
  const { farmer, logout } = useAuth();

  return (
    <View style={styles.screen}>
      <ScreenHeader title="More" />
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity style={styles.profileRow} onPress={() => navigation.navigate("Profile")}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={20} color={colors.primaryDark} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{farmer?.firstName} {farmer?.lastName}</Text>
            <Text style={styles.profileSub}>Farmer · {farmer?.farmerId}</Text>
          </View>
          <View style={styles.viewProfileRow}>
            <Text style={styles.viewProfile}>View Profile</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.primaryDark} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.validationCard, { backgroundColor: colors.blueBg }]} onPress={() => navigation.navigate("Requests")}>
          <View style={[styles.validationIcon, { backgroundColor: colors.blue }]}>
            <Ionicons name="mail" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.validationTitle, { color: colors.blue }]}>Commodity Requests</Text>
            <Text style={[styles.validationSub, { color: colors.blue }]}>Request additional commodities from your FA President</Text>
          </View>
          <View style={[styles.validationBtn, { backgroundColor: colors.blue }]}>
            <Text style={styles.validationBtnText}>View</Text>
          </View>
        </TouchableOpacity>

        <Section
          title="Account"
          items={ACCOUNT_ITEMS.map((item) =>
            item.label === "My Information" ? { ...item, onPress: () => navigation.navigate("Profile") } : item,
          )}
        />
        <Section title="Support" items={SUPPORT_ITEMS} />
        <Section title="Other" items={OTHER_ITEMS} />

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
    marginBottom: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: { fontSize: 13.5, fontWeight: "700", color: colors.text },
  profileSub: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  viewProfileRow: { flexDirection: "row", alignItems: "center" },
  viewProfile: { fontSize: 11, color: colors.primaryDark, fontWeight: "600" },

  validationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 20,
  },
  validationIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  validationTitle: { fontSize: 13.5, fontWeight: "700", color: colors.primaryDarker },
  validationSub: { fontSize: 10.5, color: colors.primaryDark, marginTop: 2 },
  validationBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 10 },
  validationBtnText: { color: "#fff", fontSize: 10.5, fontWeight: "700" },

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
