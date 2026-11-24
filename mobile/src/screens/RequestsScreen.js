import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Pill from "../components/Pill";
import ErrorBanner from "../components/ui/ErrorBanner";
import { colors, radius, shadows, sizes } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listCommodities } from "../lib/api/commodities";
import { createRequest, listMyRequests } from "../lib/api/requests";
import { formatDate, formatDateTime } from "../lib/dates";
import { friendlyError } from "../lib/friendlyError";
import { isWholeUnit } from "../lib/units";

const MAX_QUANTITY = 10000;
const MAX_REASON = 300;

// The first problem with the request, in plain words, or "" when it can
// be sent. (The database also refuses a quantity of 0 or less.)
function requestProblem(quantity, reason, unit) {
  if (!quantity.trim() || !reason.trim()) return "Please enter a quantity and reason for your request.";
  if (!/^\d+(\.\d{1,2})?$/.test(quantity.trim())) return "Enter the quantity as a number, for example 25.";
  const qty = Number(quantity);
  if (qty <= 0) return "Enter a quantity greater than 0.";
  if (isWholeUnit(unit) && !Number.isInteger(qty)) return `Enter a whole number: ${unit} can't be split.`;
  if (qty > MAX_QUANTITY) return `That quantity looks too large. Enter up to ${MAX_QUANTITY.toLocaleString()}.`;
  return "";
}

// A route param (route.params.presetCommodity) lets other screens deep-link
// straight into the form with a commodity pre-picked.
export default function RequestsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { farmer } = useAuth();
  const preset = route?.params?.presetCommodity;
  const [requests, setRequests] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [showForm, setShowForm] = useState(!!preset);
  const [commodity, setCommodity] = useState(preset ?? "");
  const [quantity, setQuantity] = useState("");
  // The quantity follows the suggestion (farm size × the commodity's kg/ha
  // rate) until the farmer types over it.
  const [quantityEdited, setQuantityEdited] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Blocks a second Send while the first is still going.
  const submittingRef = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(null); // request shown in the details sheet
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [mine, items] = await Promise.allSettled([listMyRequests(), listCommodities()]);
    if (mine.status === "fulfilled") setRequests(mine.value);
    if (items.status === "fulfilled") {
      setCommodities(items.value);
      // Starts on a commodity for the farmer's type (Corn Seeds for a Corn
      // farmer) when there is one.
      const typeIds = new Set((farmer?.types ?? []).map((t) => t.id));
      const own = items.value.find((c) => c.farmerTypeId != null && typeIds.has(c.farmerTypeId));
      setCommodity((c) => c || own?.name || items.value[0]?.name || "");
    }
    const failed = [mine, items].find((r) => r.status === "rejected");
    setLoadError(failed ? friendlyError(failed.reason, "Your requests couldn't be loaded. Please try again.") : "");
  }, [farmer?.types]);

  const selected = commodities.find((c) => c.name === commodity) ?? null;
  // One rate per commodity: suggested = farm size × the commodity's kg/ha rate.
  const rate = selected?.rate ?? null;
  const suggested = rate && farmer?.farmSizeHa > 0 ? Math.round(farmer.farmSizeHa * 100 * Math.round(rate * 100) / 100) / 100 : null;

  useEffect(() => {
    if (!quantityEdited) setQuantity(suggested !== null ? String(suggested) : "");
  }, [suggested, quantityEdited]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    const selectedCommodity = commodities.find((c) => c.name === commodity);
    const problem = requestProblem(quantity, reason, selectedCommodity?.unit);
    if (problem) {
      Alert.alert("Check your request", problem);
      return;
    }
    if (!selectedCommodity) {
      Alert.alert("Pick a commodity", "Please choose a commodity to request.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const newRequest = await createRequest({
        farmerId: farmer.farmerId,
        commodityId: selectedCommodity.id,
        quantity: Number(quantity),
        reason: reason.trim(),
      });
      setRequests((prev) => [newRequest, ...prev]);
      setQuantity("");
      setQuantityEdited(false);
      setReason("");
      setShowForm(false);
      Alert.alert("Request Sent", "Your request was sent to the MAO. Your Farmers' Association President can see it too.");
    } catch (err) {
      Alert.alert("Request not sent", friendlyError(err, "Your request couldn't be sent. Please try again."));
    } finally {
      submittingRef.current = false;
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={
          <>
            {!!loadError && <ErrorBanner message={loadError} onRetry={load} />}
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
                      onPress={() => {
                        setCommodity(c.name);
                        setQuantityEdited(false);
                      }}
                      style={[styles.chip, commodity === c.name && styles.chipActive]}
                    >
                      <Text style={[styles.chipText, commodity === c.name && styles.chipTextActive]} numberOfLines={1}>
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>


                <Text style={styles.fieldLabel}>Quantity ({selected?.unit ?? "kg"})</Text>
                <TextInput
                  style={styles.input}
                  value={quantity}
                  onChangeText={(v) => {
                    setQuantity(v);
                    setQuantityEdited(true);
                  }}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 25"
                  placeholderTextColor={colors.textFaint}
                />
                {suggested !== null && (
                  <Text style={styles.hint}>
                    Suggested for your {farmer.farmSizeHa.toFixed(2)} ha × {rate.toLocaleString()} kg/ha: {suggested.toLocaleString()} kg
                  </Text>
                )}

                <Text style={styles.fieldLabel}>Reason for Request</Text>
                <TextInput
                  style={[styles.input, { height: 70, textAlignVertical: "top" }]}
                  value={reason}
                  onChangeText={setReason}
                  multiline
                  maxLength={MAX_REASON}
                  placeholder="Explain why you need this commodity"
                  placeholderTextColor={colors.textFaint}
                />

                <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
                  <Ionicons name="send" size={14} color="#fff" />
                  <Text style={styles.submitText}>{submitting ? "Sending…" : "Send to the MAO"}</Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.sectionTitle}>My Requests</Text>
          </>
        }
        renderItem={({ item: r }) => (
          <Pressable
            onPress={() => setOpen(r)}
            accessibilityRole="button"
            accessibilityLabel={`${r.commodity}, ${r.quantity} ${r.unit}, ${r.status}${r.filedByFa ? ", filed by Farmers' Association President" : ""}. Open details`}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{r.commodity}</Text>
              <Pill status={r.status} />
            </View>
            <Text style={styles.cardSub}>{r.quantity.toLocaleString()} {r.unit} · Requested {formatDate(r.requestDate)}</Text>
            {r.filedByFa && (
              <View style={styles.filedTag}>
                <Ionicons name="people" size={11} color={colors.blueText} />
                <Text style={styles.filedTagText}>Filed by Farmers' Association President</Text>
              </View>
            )}
            <Text style={styles.cardReason} numberOfLines={2}>{r.reason}</Text>
            {r.status === "Rejected" && !!r.maoRemarks && <Text style={styles.cardRemarks}>MAO: {r.maoRemarks}</Text>}
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>You haven't sent any commodity requests yet.</Text>}
      />
      <RequestDetails request={open} onClose={() => setOpen(null)} />
    </View>
  );
}

// A request's details: what was asked for, who filed it (the farmer, or the
// Farmers' Association President for them), and the MAO's decision.
function RequestDetails({ request: r, onClose }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!r} animationType="slide" onRequestClose={onClose}>
      {r && (
        <View style={styles.screen}>
          <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity onPress={onClose} style={styles.backBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Request Details</Text>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.formCard}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { fontSize: 15 }]}>{r.commodity}</Text>
                <Pill status={r.status} />
              </View>
              {r.filedByFa && (
                <View style={[styles.filedTag, { marginTop: 4 }]}>
                  <Ionicons name="people" size={11} color={colors.blueText} />
                  <Text style={styles.filedTagText}>Filed by Farmers' Association President</Text>
                </View>
              )}
              <DetailRow label="Quantity" value={`${r.quantity.toLocaleString()} ${r.unit}`} />
              <DetailRow label="Requested" value={formatDateTime(r.requestDate)} />
              <DetailRow label="Filed by" value={r.filedByFa ? "Your Farmers' Association President, for you" : "You"} />
              <DetailRow label="Reason" value={r.reason || "—"} />
              {r.decidedAt && <DetailRow label={r.status === "Approved" ? "Approved" : r.status === "Rejected" ? "Rejected" : "Decided"} value={formatDateTime(r.decidedAt)} />}
              {!!r.maoRemarks && <DetailRow label="MAO remarks" value={r.maoRemarks} last />}
            </View>
            <Text style={styles.hint}>
              {r.status === "Pending" ? "The MAO will approve or reject it. You'll get a notification." : "This request has been decided by the MAO."}
            </Text>
          </ScrollView>
        </View>
      )}
    </Modal>
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
  cardRemarks: { fontSize: 10.5, color: colors.text, marginTop: 4 },
  hint: { fontSize: 10.5, color: colors.textMuted, marginTop: 4 },
  filedTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    backgroundColor: colors.blueBg,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  filedTagText: { fontSize: 10, fontWeight: "700", color: colors.blueText },
  detailRow: { flexDirection: "row", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { width: "34%", fontSize: 11.5, color: colors.textMuted },
  detailValue: { flex: 1, fontSize: 12.5, color: colors.text, fontWeight: "600", textAlign: "right" },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: 12.5, marginTop: 20 },
});
