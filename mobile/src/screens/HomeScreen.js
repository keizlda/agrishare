import { useEffect, useState } from "react";
import { ImageBackground, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ChevronRight, Leaf } from "lucide-react-native";
import ScreenHeader from "../components/ScreenHeader";
import StatTile from "../components/StatTile";
import Pill from "../components/Pill";
import ReminderBanner from "../components/ReminderBanner";
import { colors, radius, shadows } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listDistributions } from "../lib/api/distributions";
import dashboardBanner from "../assets/dashboard-banner.png";

export default function HomeScreen({ navigation }) {
  const { farmer } = useAuth();
  const [distributions, setDistributions] = useState([]);

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
  }, []);

  const recent = distributions.slice(0, 3);
  const homeOverview = {
    totalDistributions: distributions.length,
    totalQuantityReceived: distributions.reduce((sum, d) => sum + d.quantity, 0),
    activePrograms: distributions.filter((d) => d.status === "Ongoing").length,
    upcomingSchedules: distributions.filter((d) => d.status === "Scheduled").length,
  };

  return (
    <ImageBackground source={dashboardBanner} resizeMode="cover" style={styles.screen}>
      <ScreenHeader showLogo onBellPress={() => navigation.navigate("Announcements")} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.welcome}>Welcome Back, {farmer?.firstName}!</Text>
        <Text style={styles.sub}>Here's your farm overview.</Text>

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

        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.tileRow}>
          <StatTile icon="cube-outline" label="Total Distributions" value={homeOverview.totalDistributions} color="green" />
          <StatTile icon="people-outline" label="Total Quantity Received" value={`${homeOverview.totalQuantityReceived.toLocaleString()} kg`} color="blue" />
          <StatTile icon="clipboard-outline" label="Active Programs" value={homeOverview.activePrograms} color="orange" />
          <StatTile icon="calendar-outline" label="Upcoming Schedules" value={homeOverview.upcomingSchedules} color="purple" />
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Recent Distributions</Text>
          <TouchableOpacity onPress={() => navigation.navigate("Distributions")}>
            <Text style={styles.viewAll}>View All</Text>
          </TouchableOpacity>
        </View>

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

        <ReminderBanner text="Please make sure all distribution records are accurate and secured with your signature." actionLabel="Learn More" />
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
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  viewAll: { fontSize: 12, color: colors.primaryDark, fontWeight: "600" },

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

  tileRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },

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
