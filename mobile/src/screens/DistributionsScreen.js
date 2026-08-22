import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScreenHeader from "../components/ScreenHeader";
import StatTile from "../components/StatTile";
import Pill from "../components/Pill";
import ReminderBanner from "../components/ReminderBanner";
import { colors, radius } from "../theme";
import { listDistributions } from "../lib/api/distributions";

const TABS = ["My Distributions", "Upcoming", "History"];

export default function DistributionsScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState(TABS[0]);
  const [search, setSearch] = useState("");
  const [distributions, setDistributions] = useState([]);

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
  }, []);

  const totalQuantity = distributions.reduce((sum, d) => sum + d.quantity, 0);
  const completed = distributions.filter((d) => d.status === "Completed").length;
  const ongoing = distributions.filter((d) => d.status === "Ongoing").length;

  const byTab = useMemo(() => {
    if (tab === "Upcoming") return distributions.filter((d) => d.status === "Scheduled");
    if (tab === "History") return distributions.filter((d) => d.status === "Completed");
    return distributions.filter((d) => d.status === "Completed" || d.status === "Ongoing");
  }, [tab, distributions]);

  const filtered = useMemo(() => {
    if (!search) return byTab;
    return byTab.filter((d) => d.program.toLowerCase().includes(search.toLowerCase()));
  }, [byTab, search]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScreenHeader title="Distributions" />

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(d) => d.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.tileRow}>
              <StatTile icon="cube-outline" label="Total Distributions" value={distributions.length} color="green" />
              <StatTile icon="scale-outline" label="Total Quantity" value={`${totalQuantity.toLocaleString()} kg`} color="blue" />
              <StatTile icon="checkmark-circle-outline" label="Completed" value={completed} color="purple" />
              <StatTile icon="time-outline" label="Ongoing" value={ongoing} color="orange" />
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={15} color={colors.textMuted} style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search distribution"
                placeholderTextColor="#9aa89f"
                value={search}
                onChangeText={setSearch}
              />
            </View>
            <Text style={styles.listTitle}>Distribution List</Text>
          </>
        }
        renderItem={({ item: d }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{d.program}</Text>
              <Pill status={d.status} />
            </View>
            <Row icon="calendar-outline" text={d.date} />
            <Row icon="location-outline" text={d.venue} />
            <Row icon="leaf-outline" text={`${d.item} · ${d.quantity.toLocaleString()} ${d.unit}`} />
            <Row icon="people-outline" text={`${d.farmersReceived} Farmers Received`} />
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {tab === "Upcoming" ? "No upcoming distributions scheduled yet." : tab === "History" ? "No completed distributions yet." : "No distributions found."}
          </Text>
        }
        ListFooterComponent={
          <>
            {filtered.length > 0 && (
              <View style={styles.pagination}>
                <Text style={styles.pageText}>Showing {filtered.length} of {byTab.length}</Text>
              </View>
            )}
            <ReminderBanner text="Please make sure all distribution records are accurate and secured with your signature." actionLabel="Learn More" />
          </>
        }
      />
    </View>
  );
}

function Row({ icon, text }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={13} color={colors.textMuted} style={{ marginRight: 6 }} />
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  tabsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 6, marginBottom: 4 },
  tab: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { fontSize: 11.5, color: colors.textMuted, fontWeight: "600" },
  tabTextActive: { color: colors.primaryDark },
  tileRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 10 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    marginBottom: 14,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 12.5, color: colors.text },
  listTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text, marginBottom: 8 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: colors.text, flex: 1, marginRight: 8 },
  row: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  rowText: { fontSize: 11.5, color: colors.textMuted },
  pagination: { alignItems: "center", marginVertical: 10 },
  pageText: { fontSize: 11.5, color: colors.textMuted },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: 12.5, marginVertical: 24 },
});
