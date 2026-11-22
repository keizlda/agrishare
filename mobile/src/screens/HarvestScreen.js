import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../components/ScreenHeader";
import Pill from "../components/Pill";
import ErrorBanner from "../components/ui/ErrorBanner";
import { colors, radius, sizes } from "../theme";
import { listMyHarvestReports } from "../lib/api/harvest";
import { formatDate } from "../lib/dates";
import { friendlyError } from "../lib/friendlyError";

const fmt = (n) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

// My harvest reports (newest harvest first) and "Report Harvest". A report
// the MAO returned shows the MAO's remarks and a Resubmit button.
export default function HarvestScreen({ navigation }) {
  const [reports, setReports] = useState(null); // null while loading
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setReports(await listMyHarvestReports());
      setLoadError("");
    } catch (err) {
      setReports((prev) => prev ?? []);
      setLoadError(friendlyError(err, "Your harvest reports couldn't be loaded. Please try again."));
    }
  }, []);

  // Reloaded on every focus, so a report just sent or resubmitted shows.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Harvest Reports" onBack={() => navigation.goBack()} />
      <FlatList
        data={reports ?? []}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={
          <>
            {!!loadError && <ErrorBanner message={loadError} onRetry={load} />}
            <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate("HarvestReport")} accessibilityRole="button">
              <Ionicons name="add-circle" size={16} color="#fff" />
              <Text style={styles.newBtnText}>Report Harvest</Text>
            </TouchableOpacity>
            <Text style={styles.sectionTitle}>My Harvest Reports</Text>
          </>
        }
        renderItem={({ item: r }) => (
          <View style={[styles.card, r.statusKey === "returned" && styles.cardReturned]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle} numberOfLines={2}>{r.crop}</Text>
              <Pill status={r.status} />
            </View>
            <Text style={styles.cardSub}>{r.seasonLabel} season · Harvested {formatDate(r.harvestDate)}</Text>
            <View style={styles.figures}>
              <Figure label="Harvest" value={`${fmt(r.yieldKg)} kg`} />
              <Figure label="Area" value={`${fmt(r.areaHa)} ha`} />
              <Figure label="Yield" value={r.yieldPerHa != null ? `${fmt(r.yieldPerHa)} kg/ha` : "—"} />
            </View>
            {r.statusKey === "returned" && (
              <>
                <View style={styles.remarks}>
                  <Text style={styles.remarksLabel}>MAO remarks</Text>
                  <Text style={styles.remarksText}>{r.reviewRemarks || "Please check the details and resubmit."}</Text>
                </View>
                <TouchableOpacity style={styles.resubmitBtn} onPress={() => navigation.navigate("HarvestReport", { report: r })} accessibilityRole="button">
                  <Ionicons name="create-outline" size={15} color={colors.primaryDark} />
                  <Text style={styles.resubmitText}>Resubmit</Text>
                </TouchableOpacity>
              </>
            )}
            {r.statusKey === "verified" && !!r.reviewRemarks && <Text style={styles.note}>MAO: {r.reviewRemarks}</Text>}
            {r.statusKey === "submitted" && <Text style={styles.note}>{r.resubmittedAt ? "Resubmitted. " : ""}Waiting for the MAO to verify.</Text>}
          </View>
        )}
        ListEmptyComponent={
          reports === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : (
            <View style={styles.emptyBox}>
              <Ionicons name="leaf-outline" size={28} color={colors.textMuted} />
              <Text style={styles.empty}>No harvest reported yet. After you harvest, tap Report Harvest to tell the MAO how many kilograms you got.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

function Figure({ label, value }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: sizes.minTouchTarget,
    paddingVertical: 12,
    marginBottom: 16,
  },
  newBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sectionTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text, marginBottom: 8 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  cardReturned: { borderColor: colors.red },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text, flex: 1 },
  cardSub: { fontSize: 10.5, color: colors.textMuted },
  figures: { flexDirection: "row", gap: 8, marginTop: 8 },
  figure: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.sm, paddingVertical: 6, paddingHorizontal: 8 },
  figureLabel: { fontSize: 9.5, color: colors.textMuted, fontWeight: "600" },
  figureValue: { fontSize: 12, color: colors.text, fontWeight: "700", textAlign: "right" },
  remarks: { backgroundColor: colors.redBg, borderRadius: radius.sm, padding: 8, marginTop: 8 },
  remarksLabel: { fontSize: 9.5, fontWeight: "700", color: colors.red, marginBottom: 2 },
  remarksText: { fontSize: 11, color: colors.text, lineHeight: 15 },
  resubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: sizes.minTouchTarget,
    marginTop: 8,
  },
  resubmitText: { color: colors.primaryDark, fontWeight: "700", fontSize: 12.5 },
  note: { fontSize: 10.5, color: colors.textMuted, marginTop: 6 },
  emptyBox: { alignItems: "center", gap: 8, marginTop: 16, paddingHorizontal: 12 },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: 12.5, marginTop: 4, lineHeight: 18 },
});
