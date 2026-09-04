import { useCallback, useState } from "react";
import { FlatList, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ShieldCheck, X } from "lucide-react-native";
import ScreenHeader from "../components/ScreenHeader";
import StatTile from "../components/StatTile";
import Pill from "../components/Pill";
import EmptyState from "../components/ui/EmptyState";
import { colors, radius, shadows, spacing } from "../theme";
import { getSignedPhotoUrl, listMyCropValidations } from "../lib/api/cropValidation";

// Tab-root hub: history of past submissions + a launcher into the existing
// CropValidationScreen submission form (still a separate modal route, now
// reached from here instead of from More). Mirrors RequestsScreen's
// New-button-then-list layout, which already does this exact pattern well.
export default function ValidationScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [viewerUri, setViewerUri] = useState(null);

  // Refetches on every focus, not just first mount: this screen sits under
  // the CropValidation modal in the stack and never unmounts, so a plain
  // mount-only effect would leave a farmer looking at stale (pre-submission)
  // stats and history right after they submit and navigate back.
  useFocusEffect(
    useCallback(() => {
      listMyCropValidations()
        .then((rows) => {
          setItems(rows);
          rows.forEach((r) => {
            if (!r.photoPath) return;
            getSignedPhotoUrl(r.photoPath)
              .then((url) => setThumbs((prev) => ({ ...prev, [r.id]: url })))
              .catch(() => {});
          });
        })
        .catch(() => {});
    }, [])
  );

  const pending = items.filter((i) => i.status === "Pending").length;
  const validated = items.filter((i) => i.status === "Validated").length;
  const rejected = items.filter((i) => i.status === "Rejected").length;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Crop Validation" />
      <FlatList
        data={items}
        keyExtractor={(i) => String(i.id)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate("CropValidation")}>
              <ShieldCheck size={16} color="#fff" />
              <Text style={styles.newBtnText}>New Validation</Text>
            </TouchableOpacity>

            <View style={styles.tileRow}>
              <StatTile icon="document-text-outline" label="Total Submitted" value={items.length} color="green" />
              <StatTile icon="time-outline" label="Pending" value={pending} color="orange" />
              <StatTile icon="checkmark-circle-outline" label="Validated" value={validated} color="blue" />
              <StatTile icon="close-circle-outline" label="Rejected" value={rejected} color="red" />
            </View>
            <Text style={styles.sectionTitle}>Submission History</Text>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={thumbs[item.id] ? 0.7 : 1}
            onPress={() => thumbs[item.id] && setViewerUri(thumbs[item.id])}
          >
            {thumbs[item.id] ? (
              <Image source={{ uri: thumbs[item.id] }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <ShieldCheck size={16} color={colors.primaryDark} />
              </View>
            )}
            <View style={styles.cardBody}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardDate}>{item.submittedAt ? item.submittedAt.slice(0, 10) : "—"}</Text>
                <Pill status={item.status} />
              </View>
              {!!item.remarks && (
                <Text style={styles.cardRemarks} numberOfLines={2}>
                  {item.status === "Rejected" ? "Reason: " : ""}
                  {item.remarks}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<EmptyState icon={ShieldCheck} message="You haven't submitted any crop validations yet." />}
      />

      {/* The photo already has the geotag stamp (place/coords/date/accuracy)
          burned into it from the submission flow, so a plain full-size
          viewer is enough detail without duplicating that as separate UI. */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <TouchableOpacity style={styles.viewerBackdrop} activeOpacity={1} onPress={() => setViewerUri(null)}>
          <TouchableOpacity style={styles.viewerCloseBtn} onPress={() => setViewerUri(null)}>
            <X size={22} color="#fff" />
          </TouchableOpacity>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>
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
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 12,
    marginBottom: spacing.base,
  },
  newBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  tileRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  sectionTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text, marginBottom: spacing.sm, marginTop: spacing.xs },

  card: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  thumb: { width: 52, height: 52, borderRadius: radius.sm },
  thumbPlaceholder: { backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1, justifyContent: "center" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardDate: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  cardRemarks: { fontSize: 11, color: colors.textMuted, marginTop: 4 },

  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerCloseBtn: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 1,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: { width: "100%", height: "80%" },
});
