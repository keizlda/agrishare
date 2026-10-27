import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Pin, X } from "lucide-react-native";
import { colors, radius, spacing } from "../theme";
import { getAnnouncementImageUrl, isTaggedInDistribution } from "../lib/api/announcements";
import { formatDate } from "../lib/dates";

// Full-screen details for one announcement — opened from the Announcements
// screen and from the Announcements card on Home. Loads the post's image and
// whether this farmer is tagged in the linked distribution on open.
export default function AnnouncementDetailModal({ announcement: open, onClose }) {
  const [image, setImage] = useState(null);
  const [included, setIncluded] = useState(false);

  useEffect(() => {
    setImage(null);
    setIncluded(false);
    if (!open) return undefined;
    let cancelled = false;
    if (open.imagePath) getAnnouncementImageUrl(open.imagePath).then((url) => !cancelled && setImage(url)).catch(() => {});
    if (open.linkedDistributionId) isTaggedInDistribution(open.linkedDistributionId).then((v) => !cancelled && setIncluded(v)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open?.id]);

  return (
    <Modal visible={!!open} animationType="slide" onRequestClose={onClose}>
      {open && (
        <View style={styles.detail}>
          <View style={styles.detailBar}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.detailContent}>
            {open.isPinned && (
              <View style={[styles.pinned, { marginBottom: 8 }]}>
                <Pin size={11} color={colors.primaryDark} />
                <Text style={styles.pinnedText}>Pinned</Text>
              </View>
            )}
            <Text style={styles.detailTitle}>{open.title}</Text>
            <Text style={styles.detailDate}>
              Posted {open.date}
              {open.wasForwarded ? " · Forwarded by your Farmers' Association President" : ""}
            </Text>

            {included && (
              <View style={styles.includedBanner}>
                <Ionicons name="checkmark-circle" size={16} color={colors.primaryDark} />
                <Text style={styles.includedText}>You are included in this distribution</Text>
              </View>
            )}

            {!!open.imagePath &&
              (image ? (
                <Image source={{ uri: image }} style={styles.detailImage} resizeMode="cover" />
              ) : (
                <View style={[styles.detailImage, styles.imagePlaceholder]}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ))}

            {!open.isGeneralNotice && (
              <View style={styles.detailKvGroup}>
                <DetailRow label="Distribution Date" value={open.distributionDate ? formatDate(open.distributionDate) : null} />
                <DetailRow label="Time" value={open.distributionTime} />
                <DetailRow label="Venue" value={open.venue} />
                <DetailRow label="Type of Assistance" value={open.assistanceType} />
                <DetailRow label="Requirements Needed" value={open.requirements} last />
              </View>
            )}

            {!!open.body && (
              <Text style={styles.detailBody} selectable>
                {open.body}
              </Text>
            )}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

function DetailRow({ label, value, last }) {
  if (!value) return null;
  return (
    <View style={[styles.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pinned: { flexDirection: "row", alignItems: "center", gap: 3 },
  pinnedText: { fontSize: 10.5, fontWeight: "700", color: colors.primaryDark },

  detail: { flex: 1, backgroundColor: colors.bg },
  detailBar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.header },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  detailContent: { padding: spacing.base, paddingBottom: 48 },
  detailTitle: { fontSize: 20, fontWeight: "800", color: colors.text, lineHeight: 26 },
  detailDate: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: 14 },
  detailImage: { width: "100%", height: 200, borderRadius: radius.md, marginBottom: 14 },
  imagePlaceholder: { backgroundColor: colors.header, alignItems: "center", justifyContent: "center" },
  detailBody: { fontSize: 14.5, color: colors.text, lineHeight: 22, marginTop: 14 },

  includedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  includedText: { fontSize: 12.5, fontWeight: "700", color: colors.primaryDark, flex: 1 },

  detailKvGroup: { marginTop: 16 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  // Label: a fixed 40% of the row, not its measured width (ProfileScreen Row).
  detailLabel: { width: "38%", fontSize: 11.5, color: colors.textMuted },
  detailValue: { flex: 1, fontSize: 12.5, color: colors.text, fontWeight: "600", textAlign: "right" },
});
