import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../components/ScreenHeader";
import StatTile from "../components/StatTile";
import Pill from "../components/Pill";
import ReminderBanner from "../components/ReminderBanner";
import { colors, radius } from "../theme";
import { listCommodities } from "../lib/api/commodities";
import { listDistributions } from "../lib/api/distributions";

const CATEGORY_ICON = {
  Rice: "leaf-outline",
  Corn: "leaf-outline",
  Vegetables: "leaf-outline",
  Fertilizer: "flask-outline",
  "Farm Tools": "construct-outline",
  Livestock: "paw-outline",
};

export default function CommoditiesScreen({ navigation }) {
  const [search, setSearch] = useState("");
  const [commodities, setCommodities] = useState([]);
  const [distributed, setDistributed] = useState({});

  useEffect(() => {
    listCommodities().then(setCommodities).catch(() => {});
    listDistributions().then((rows) => {
      const totals = {};
      for (const d of rows) totals[d.item] = (totals[d.item] ?? 0) + d.quantity;
      setDistributed(totals);
    }).catch(() => {});
  }, []);

  const active = commodities.filter((c) => c.status === "Active").length;
  const categoryCount = new Set(commodities.map((c) => c.category)).size;
  const totalDistributed = Object.values(distributed).reduce((sum, q) => sum + q, 0);

  const filtered = useMemo(() => {
    if (!search) return commodities;
    return commodities.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  }, [commodities, search]);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Commodities" />

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={15} color={colors.textMuted} style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search commodity"
                placeholderTextColor="#9aa89f"
                value={search}
                onChangeText={setSearch}
              />
            </View>

            <Text style={styles.sectionTitle}>Commodity Overview</Text>
            <View style={styles.tileRow}>
              <StatTile icon="cube-outline" label="Total Commodities" value={commodities.length} color="green" />
              <StatTile icon="checkmark-circle-outline" label="Active" value={active} color="blue" />
              <StatTile icon="grid-outline" label="Categories" value={categoryCount} color="orange" />
              <StatTile icon="scale-outline" label="Total Distributed" value={`${totalDistributed.toLocaleString()} kg`} color="purple" />
            </View>
            <Text style={styles.sectionTitle}>Commodity List</Text>
          </>
        }
        renderItem={({ item: c }) => (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name={CATEGORY_ICON[c.category] ?? "cube-outline"} size={17} color={colors.primaryDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{c.name}</Text>
              <Text style={styles.cardSub}>
                {c.category} · {(distributed[c.name] ?? 0).toLocaleString()} {c.unit} distributed
              </Text>
            </View>
            <Pill status={c.status} />
            <TouchableOpacity
              style={styles.requestBtn}
              onPress={() => navigation.navigate("Requests", { presetCommodity: c.name })}
            >
              <Ionicons name="add" size={16} color={colors.primaryDark} />
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={
          <ReminderBanner text="Please ensure all commodities are stored properly and inventory is updated regularly." actionLabel="Learn More" />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
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
  sectionTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text, marginBottom: 8, marginTop: 2 },
  tileRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
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
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  cardSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
  requestBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
});
