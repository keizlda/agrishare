import { useCallback, useMemo, useState } from "react";
import { FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Truck, X } from "lucide-react-native";
import { useFocusEffect } from "@react-navigation/native";
import ScreenHeader from "../components/ScreenHeader";
import Pill from "../components/Pill";
import EmptyState from "../components/ui/EmptyState";
import { colors, radius, shadows, spacing } from "../theme";
import { listMyDistributions } from "../lib/api/distributions";

function recentBadge(status) {
  if (status === "Completed") return "Received";
  if (status === "Ongoing" || status === "Scheduled") return "Upcoming";
  return status;
}

// Flattens [{...distribution}] (already newest-first) into a list with
// interleaved year-header rows, so one FlatList can render both — same
// plain-FlatList pattern the rest of the app uses rather than SectionList.
function withYearHeaders(distributions) {
  const rows = [];
  let lastYear = null;
  for (const d of distributions) {
    const year = d.date ? new Date(d.date).getFullYear() : "Undated";
    if (year !== lastYear) {
      rows.push({ rowType: "header", key: `year-${year}`, year });
      lastYear = year;
    }
    rows.push({ rowType: "item", key: `claim-${d.claimId}`, ...d });
  }
  return rows;
}

export default function MyDistributionsScreen({ navigation }) {
  const [distributions, setDistributions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      setDistributions(await listMyDistributions());
    } catch {
      // leave the previous list in place; pull-to-refresh can retry
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function onRefresh() {
    setRefreshing(true);
    load();
  }

  const rows = useMemo(() => withYearHeaders(distributions), [distributions]);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="My Distributions" onBack={() => navigation.goBack()} />

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        renderItem={({ item }) =>
          item.rowType === "header" ? (
            <Text style={styles.yearHeader}>{item.year}</Text>
          ) : (
            <TouchableOpacity activeOpacity={0.7} onPress={() => setOpen(item)} style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.program}</Text>
                <Text style={styles.cardSub}>{item.date} · {item.venue}</Text>
                <Text style={styles.cardSub}>{item.item} · {item.quantity.toLocaleString()} {item.unit}</Text>
              </View>
              <Pill status={recentBadge(item.status)} />
            </TouchableOpacity>
          )
        }
        ListEmptyComponent={
          !loading && (
            <EmptyState icon={Truck} message="You haven't been tagged in any distribution yet." style={{ marginTop: 40 }} />
          )
        }
      />

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        {open && (
          <View style={styles.detail}>
            <View style={styles.detailBar}>
              <TouchableOpacity onPress={() => setOpen(null)} style={styles.closeBtn} accessibilityLabel="Close">
                <X size={20} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.detailContent}>
              <Text style={styles.detailTitle}>{open.program}</Text>
              <Pill status={recentBadge(open.status)} />

              <View style={styles.detailKvGroup}>
                <DetailRow label="Commodity" value={open.item} />
                <DetailRow label="Quantity" value={`${open.quantity.toLocaleString()} ${open.unit}`} />
                <DetailRow label="Date" value={open.date} />
                <DetailRow label="Venue" value={open.venue} />
                <DetailRow label="Funding Source" value={open.fundingSource || "—"} />
                <DetailRow label="Your Acknowledgement" value={open.acknowledgementStatus} last />
              </View>
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

function DetailRow({ label, value, last }) {
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  yearHeader: { fontSize: 12.5, fontWeight: "800", color: colors.textMuted, marginTop: 12, marginBottom: 8 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
    ...shadows.card,
  },
  cardTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
  cardSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },

  detail: { flex: 1, backgroundColor: colors.card },
  detailBar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  detailContent: { padding: spacing.base, paddingBottom: 48 },
  detailTitle: { fontSize: 20, fontWeight: "800", color: colors.text, lineHeight: 26, marginBottom: 8 },
  detailKvGroup: { marginTop: 18 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { fontSize: 12, color: colors.textMuted },
  detailValue: { fontSize: 12.5, color: colors.text, fontWeight: "600" },
});
