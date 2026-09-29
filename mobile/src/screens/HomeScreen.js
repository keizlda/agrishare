import { useEffect, useState } from "react";
import { ImageBackground, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ChevronRight, Leaf, Package } from "lucide-react-native";
import ScreenHeader from "../components/ScreenHeader";
import Pill from "../components/Pill";
import ReminderBanner from "../components/ReminderBanner";
import { colors, radius, shadows } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listDistributions } from "../lib/api/distributions";
import { useTabBarHeight } from "../hooks/useTabBarHeight";
import dashboardBanner from "../assets/dashboard-banner.png";

export default function HomeScreen({ navigation }) {
  const { farmer } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const [distributions, setDistributions] = useState([]);

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
  }, []);

  const recent = distributions.slice(0, 3);

  return (
    <ImageBackground source={dashboardBanner} resizeMode="cover" style={styles.screen}>
      <ScreenHeader showLogo onBellPress={() => navigation.navigate("Announcements")} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight }]}>
        <Text style={styles.welcome}>Welcome Back, {farmer?.firstName}!</Text>
        <Text style={styles.sub}>Here's your farm overview.</Text>

        <TouchableOpacity style={styles.requestCard} onPress={() => navigation.navigate("Requests")}>
          <View style={styles.requestIcon}>
            <Package size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.requestTitle}>Request Commodity</Text>
            <Text style={styles.requestSub}>Submit a request for seeds, fertilizer, or tools</Text>
          </View>
          <ChevronRight size={16} color={colors.primaryDark} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.infoCard} onPress={() => navigation.navigate("Profile")}>
          <View style={styles.infoHeader}>
            <Text style={styles.infoTitle}>My Information</Text>
            <View style={styles.viewProfileRow}>
              <Text style={styles.viewProfile}>View Profile</Text>
              <ChevronRight size={13} color={colors.primaryDark} />
            </View>
          </View>
          <InfoRow label="Farmer ID" value={farmer?.farmerId} />
          <InfoRow label="RSBSA Number" value={farmer?.rsbsaNo} badge={farmer?.validationStatus} />
          <InfoRow label="Barangay" value={farmer?.barangay} />
          <InfoRow label="Contact Number" value={farmer?.contactNo} />
          <InfoRow label="Farm Size" value={farmer?.farmSize} />
          <InfoRow label="Primary Commodity" value={farmer?.primaryCommodity} last />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Recent Distributions</Text>

        <View style={styles.card}>
          {recent.map((d, i) => (
            <View key={d.id} style={[styles.distRow, i === recent.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={styles.distIcon}>
                <Leaf size={16} color={colors.primaryDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.distTitle}>{d.program}</Text>
                <Text style={styles.distSub}>
                  {d.date} · {d.venue} · {d.item} · {d.quantity.toLocaleString()} {d.unit}
                </Text>
              </View>
              <Pill status={d.status} />
            </View>
          ))}
        </View>

        <ReminderBanner text="Please make sure all distribution records are accurate and secured with your signature." />
      </ScrollView>
    </ImageBackground>
  );
}

function InfoRow({ label, value, badge, last }) {
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={styles.infoValue}>{value}</Text>
        {badge && <Pill status={badge} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  welcome: { fontSize: 19, fontWeight: "800", color: colors.text },
  sub: { fontSize: 12.5, color: colors.textMuted, marginTop: 2, marginBottom: 14 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 8, marginTop: 4 },

  requestCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 18,
  },
  requestIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  requestTitle: { fontSize: 13.5, fontWeight: "700", color: colors.primaryDarker },
  requestSub: { fontSize: 10.5, color: colors.primaryDark, marginTop: 2 },

  infoCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 18,
    ...shadows.card,
  },
  infoHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  infoTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text },
  viewProfileRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  viewProfile: { fontSize: 11.5, color: colors.primaryDark, fontWeight: "600" },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { fontSize: 11.5, color: colors.textMuted },
  infoValue: { fontSize: 12.5, color: colors.text, fontWeight: "600" },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 4,
    marginBottom: 8,
    ...shadows.card,
  },
  distRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  distIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  distTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  distSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
});
