import { useEffect, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Pill from "../components/Pill";
import { colors, radius, shadows, sizes } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listCommodities } from "../lib/api/commodities";
import { createRequest, listMyRequests } from "../lib/api/requests";

// A route param (route.params.presetCommodity) lets other screens (e.g.
// Commodities) deep-link straight into the form with a commodity pre-picked.
export default function RequestsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { farmer } = useAuth();
  const preset = route?.params?.presetCommodity;
  const [requests, setRequests] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [showForm, setShowForm] = useState(!!preset);
  const [commodity, setCommodity] = useState(preset ?? "");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listMyRequests().then(setRequests).catch(() => {});
    listCommodities().then((rows) => {
      setCommodities(rows);
      setCommodity((c) => c || rows[0]?.name || "");
    }).catch(() => {});
  }, []);

  async function handleSubmit() {
    if (!quantity || !reason) {
      Alert.alert("Missing details", "Please enter a quantity and reason for your request.");
      return;
    }
    const selectedCommodity = commodities.find((c) => c.name === commodity);
    if (!selectedCommodity) {
      Alert.alert("Pick a commodity", "Please choose a commodity to request.");
      return;
    }
    setSubmitting(true);
    try {
      const newRequest = await createRequest({
        farmerId: farmer.farmerId,
        commodityId: selectedCommodity.id,
        quantity,
        reason,
      });
      setRequests((prev) => [newRequest, ...prev]);
      setQuantity("");
      setReason("");
      setShowForm(false);
      Alert.alert("Request Sent", "Your commodity request has been sent to your FA President for review.");
    } catch (err) {
      Alert.alert("Request failed", err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <Ionicons name="mail-outline" size={16} color={colors.primaryDark} />
        <Text style={styles.headerTitle}>Commodity Requests</Text>
      </View>

      <FlatList
        data={requests}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            {!showForm && (
              <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)}>
                <Ionicons name="add-circle" size={16} color="#fff" />
                <Text style={styles.newBtnText}>New Request</Text>
              </TouchableOpacity>
            )}

            {showForm && (
              <View style={styles.formCard}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>New Commodity Request</Text>
                  <TouchableOpacity onPress={() => setShowForm(false)}>
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>Commodity</Text>
                <View style={styles.chipRow}>
                  {commodities.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setCommodity(c.name)}
                      style={[styles.chip, commodity === c.name && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, commodity === c.name && styles.chipTextActive]} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>Quantity (kg)</Text>
                <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" placeholder="e.g. 25" placeholderTextColor="#9aa89f" />

                <Text style={styles.fieldLabel}>Reason for Request</Text>
                <TextInput
                  style={[styles.input, { height: 70, textAlignVertical: "top" }]}
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  placeholder="Explain why you need this commodity"
                  placeholderTextColor="#9aa89f"
                />

                <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
                  <Ionicons name="send" size={14} color="#fff" />
                  <Text style={styles.submitText}>{submitting ? "Sending…" : "Send to FA President"}</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sectionTitle}>My Requests</Text>
          </>
        }
        renderItem={({ item: r }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{r.commodity}</Text>
              <Pill status={r.status} />
            </View>
            <Text style={styles.cardSub}>{r.quantity.toLocaleString()} {r.unit} · Requested {r.requestDate}</Text>
            <Text style={styles.cardReason} numberOfLines={2}>{r.reason}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>You haven't sent any commodity requests yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: sizes.minTouchTarget / 2,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  headerTitle: { fontSize: 14.5, fontWeight: "700", color: colors.text },
  content: { padding: 16, paddingBottom: 32 },

  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 12,
    marginBottom: 16,
  },
  newBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  formCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 18,
  },
  formHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  formTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
  fieldLabel: { fontSize: 10.5, fontWeight: "700", color: colors.textMuted, marginTop: 8, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, maxWidth: "100%" },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 10.5, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12.5,
    color: colors.text,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primaryDark,
    borderRadius: radius.sm,
    paddingVertical: 11,
    marginTop: 14,
  },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 12.5 },

  sectionTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text, marginBottom: 8 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  cardTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text, flex: 1, marginRight: 8 },
  cardSub: { fontSize: 10.5, color: colors.textMuted, marginBottom: 4 },
  cardReason: { fontSize: 10.5, color: colors.textMuted, fontStyle: "italic" },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: 12.5, marginTop: 20 },
});
