import { useCallback, useState } from "react";
import { Image, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Check, Clock, MapPin, RefreshCw, Wheat, X } from "lucide-react-native";
import TabScreenLayout, { PageTitle, tabCard } from "../components/TabScreenLayout";
import Pill from "../components/Pill";
import ErrorBanner from "../components/ui/ErrorBanner";
import { colors, radius, shadow, spacing } from "../theme";
import { getHarvestPhotoUrl, listMyHarvestReports } from "../lib/api/harvest";
import { useTabBarHeight } from "../hooks/useTabBarHeight";
import { formatDate as fmtDate, formatDateTime as fmtDateTime } from "../lib/dates";
import { friendlyError } from "../lib/friendlyError";

// Harvest Reports (reached from Home's "Report Harvest" card), laid out like
// the Proof of Planting tab: a prominent "Report Harvest" card that opens the
// existing form, a tracker for the latest report, and the older ones as
// History. Every report opens full details (photo, figures, remarks).
// Kilograms only.

const fmt = (n) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const kg = (n) => `${fmt(n)} kg`;
const perHa = (r) => (r.yieldPerHa != null ? `${fmt(r.yieldPerHa)} kg/ha` : null);
const area = (r) => (r.areaHa != null ? `${r.areaHa.toFixed(2)} ha` : null);
// The latest filed (or resubmitted) report first.
const filedAt = (r) => r.resubmittedAt ?? r.createdAt ?? "";

function historySummary(items) {
  const n = (s) => items.filter((i) => i.statusKey === s).length;
  return [
    n("verified") && `${n("verified")} verified`,
    n("submitted") && `${n("submitted")} waiting`,
    n("returned") && `${n("returned")} returned`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function HarvestScreen({ navigation }) {
  const tabBarHeight = useTabBarHeight();
  const [items, setItems] = useState(null); // null while the first load runs
  const [thumbs, setThumbs] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(null); // report shown in the details sheet
  const [viewerUri, setViewerUri] = useState(null);
  // Shown with Try again instead of an empty history when loading fails.
  const [loadError, setLoadError] = useState("");

  // Reloaded on every focus, so a report just sent or resubmitted shows.
  const load = useCallback(async () => {
    try {
      const rows = (await listMyHarvestReports()).sort((a, b) => String(filedAt(b)).localeCompare(String(filedAt(a))));
      setItems(rows);
      setLoadError("");
      rows.forEach((r) => {
        if (!r.photoPath) return;
        getHarvestPhotoUrl(r.photoPath)
          .then((url) => setThumbs((prev) => ({ ...prev, [r.id]: url })))
          .catch(() => {});
      });
    } catch (err) {
      setItems((prev) => prev ?? []);
      setLoadError(friendlyError(err, "Your harvest reports couldn't be loaded. Please try again."));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const report = () => navigation.navigate("HarvestReport");
  const resubmit = (r) => navigation.navigate("HarvestReport", { report: r });
  const latest = items?.[0] ?? null;
  const history = items?.slice(1) ?? [];

  return (
    <TabScreenLayout navigation={navigation}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 16 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <PageTitle>Harvest Reports</PageTitle>

        {!!loadError && <ErrorBanner message={loadError} onRetry={load} />}

        <Pressable
          onPress={report}
          accessibilityRole="button"
          accessibilityLabel="Report harvest"
          accessibilityHint="Enter your yield in kilograms and add a photo of your harvest"
          style={({ pressed }) => [styles.submitCard, pressed && styles.submitCardPressed]}
        >
          <View style={styles.submitIconCircle}>
            <MaterialCommunityIcons name="scale" size={26} color="#fff" />
          </View>
          <Text style={styles.submitTitle}>Report Harvest</Text>
          <Text style={styles.submitSub}>Yield in kilograms with a photo of your harvest</Text>
        </Pressable>

        {items === null ? (
          <LoadingSkeleton />
        ) : !latest ? (
          <View style={styles.emptyWrap}>
            <Wheat size={28} color={colors.iconFaint} />
            <Text style={styles.emptyText}>You haven't reported a harvest yet.</Text>
          </View>
        ) : (
          <>
            <LatestReport item={latest} onOpen={() => setOpen(latest)} onResubmit={() => resubmit(latest)} />

            {history.length > 0 && (
              <>
                <View style={styles.historyHeader}>
                  <Text style={styles.sectionTitle}>History</Text>
                  <Text style={styles.historySummary}>{historySummary(history)}</Text>
                </View>
                {history.map((item) => (
                  <HistoryCard key={item.id} item={item} thumb={thumbs[item.id]} onOpen={() => setOpen(item)} onResubmit={() => resubmit(item)} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      <ReportDetails
        item={open}
        photo={open ? thumbs[open.id] : null}
        onClose={() => setOpen(null)}
        onViewPhoto={setViewerUri}
        onResubmit={() => {
          const r = open;
          setOpen(null);
          resubmit(r);
        }}
      />

      {/* The photo already carries the geotag stamp from the capture screen,
          so a plain full-size viewer is enough. */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <TouchableOpacity style={styles.viewerBackdrop} activeOpacity={1} onPress={() => setViewerUri(null)}>
          <TouchableOpacity style={styles.viewerCloseBtn} onPress={() => setViewerUri(null)} accessibilityLabel="Close photo">
            <X size={22} color="#fff" />
          </TouchableOpacity>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>
    </TabScreenLayout>
  );
}

// ---------------------------------------------------------------------------
// Latest report: Submitted -> Under review -> Verified / Returned
// ---------------------------------------------------------------------------
function LatestReport({ item, onOpen, onResubmit }) {
  const returned = item.statusKey === "returned";
  const statusText = item.statusKey === "submitted" ? "under review" : item.status.toLowerCase();
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Latest report, ${item.crop}, ${statusText}. Open details`}
      style={({ pressed }) => [styles.card, styles.latestCard, pressed && styles.cardPressed]}
    >
      <View style={styles.latestHeader}>
        <Text style={styles.cardTitle}>Latest report</Text>
        <Text style={styles.latestDate}>{fmtDate(item.harvestDate)}</Text>
      </View>
      <Text style={styles.latestMeta} numberOfLines={2}>
        {[item.crop, area(item), kg(item.yieldKg)].filter(Boolean).join(" · ")}
      </Text>

      <StatusTracker status={item.statusKey} reviewedAt={item.reviewedAt} />

      {returned && (
        <>
          <Text style={styles.rejectRemarks}>{item.reviewRemarks || "Please check the details and resubmit."}</Text>
          <TouchableOpacity style={styles.resubmitBtn} onPress={onResubmit} accessibilityRole="button" accessibilityLabel="Resubmit harvest report">
            <RefreshCw size={13} color="#fff" />
            <Text style={styles.resubmitText}>Resubmit</Text>
          </TouchableOpacity>
        </>
      )}
    </Pressable>
  );
}

const STEP_COLORS = {
  done: { bg: colors.primary, fg: "#fff" },
  current: { bg: colors.orange, fg: "#fff" },
  rejected: { bg: colors.red, fg: "#fff" },
  todo: { bg: colors.grayBg, fg: colors.textFaint },
};

function StatusTracker({ status, reviewedAt }) {
  const waiting = status === "submitted";
  const verified = status === "verified";
  const returned = status === "returned";
  const steps = [
    { label: "Submitted", state: "done" },
    { label: "Under review", state: waiting ? "current" : "done" },
    {
      label: verified ? `Verified on ${fmtDate(reviewedAt)}` : returned ? "Returned" : "Verified",
      state: verified ? "done" : returned ? "rejected" : "todo",
    },
  ];
  // A connecting line turns green once the step it leads to has been reached.
  const reached = (i) => steps[i].state !== "todo";
  return (
    <View style={styles.tracker} accessibilityLabel={`Status: ${steps.map((s) => `${s.label}${s.state === "current" ? " (current)" : ""}`).join(", ")}`}>
      {steps.map((step, i) => {
        const c = STEP_COLORS[step.state];
        const Icon = step.state === "current" ? Clock : step.state === "rejected" ? X : step.state === "done" ? Check : null;
        return (
          <View key={i} style={styles.step}>
            {i > 0 && <View style={[styles.connector, styles.connectorLeft, reached(i) && styles.connectorOn]} />}
            {i < steps.length - 1 && <View style={[styles.connector, styles.connectorRight, reached(i + 1) && styles.connectorOn]} />}
            <View style={[styles.stepCircle, { backgroundColor: c.bg }]}>
              {Icon ? <Icon size={15} color={c.fg} strokeWidth={3} /> : <Text style={styles.stepNumber}>{i + 1}</Text>}
            </View>
            <Text
              style={[
                styles.stepLabel,
                step.state === "current" && styles.stepLabelCurrent,
                step.state === "rejected" && styles.stepLabelRejected,
                step.state === "todo" && styles.stepLabelTodo,
              ]}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
function HistoryCard({ item, thumb, onOpen, onResubmit }) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${item.crop}, ${item.seasonLabel} season, ${kg(item.yieldKg)}, ${item.status}. Open details`}
      style={({ pressed }) => [styles.card, styles.historyCard, pressed && styles.cardPressed]}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Wheat size={18} color={colors.primaryDark} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.historyTop}>
          <Text style={styles.historyCrop} numberOfLines={1}>{item.crop}</Text>
          <Pill status={item.status} />
        </View>
        <Text style={styles.historyLine} numberOfLines={1}>
          {[`${item.seasonLabel} season`, kg(item.yieldKg), perHa(item)].filter(Boolean).join(" · ")}
        </Text>
        {item.statusKey === "returned" && (
          <View style={styles.historyRejectRow}>
            <Text style={styles.historyReject} numberOfLines={2}>{item.reviewRemarks || "Please check the details and resubmit."}</Text>
            <TouchableOpacity onPress={onResubmit} accessibilityRole="link" accessibilityLabel="Resubmit harvest report" hitSlop={8}>
              <Text style={styles.resubmitLink}>Resubmit</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function LoadingSkeleton() {
  return (
    <View accessibilityLabel="Loading harvest reports">
      <View style={[styles.card, styles.latestCard]}>
        <View style={[styles.skeleton, { width: "45%", height: 13 }]} />
        <View style={[styles.skeleton, { width: "65%", height: 10, marginTop: 8 }]} />
        <View style={[styles.skeleton, { width: "100%", height: 46, marginTop: 16 }]} />
      </View>
      {[0, 1].map((i) => (
        <View key={i} style={[styles.card, styles.historyCard]}>
          <View style={[styles.thumb, styles.skeleton]} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skeleton, { width: "50%", height: 12 }]} />
            <View style={[styles.skeleton, { width: "70%", height: 10 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Full details: photo, figures, remarks
// ---------------------------------------------------------------------------
function ReportDetails({ item, photo, onClose, onViewPhoto, onResubmit }) {
  const hasGps = item?.latitude != null && item?.longitude != null;
  return (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose}>
      {item && (
        <View style={styles.detail}>
          <View style={styles.detailBar}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <X size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.detailContent}>
            {photo ? (
              <TouchableOpacity onPress={() => onViewPhoto(photo)} accessibilityLabel="View photo full screen">
                <Image source={{ uri: photo }} style={styles.detailPhoto} resizeMode="cover" />
              </TouchableOpacity>
            ) : (
              <View style={[styles.detailPhoto, styles.thumbPlaceholder]}>
                <Wheat size={30} color={colors.primaryDark} />
                <Text style={styles.noPhotoText}>No photo added</Text>
              </View>
            )}

            <View style={styles.detailTitleRow}>
              <Text style={styles.detailTitle}>{item.crop}</Text>
              <Pill status={item.status} />
            </View>
            <StatusTracker status={item.statusKey} reviewedAt={item.reviewedAt} />

            <View style={styles.detailKvGroup}>
              <DetailRow label="Season" value={item.seasonLabel} />
              <DetailRow label="Harvest date" value={fmtDate(item.harvestDate)} />
              <DetailRow label="Area harvested" value={area(item)} />
              <DetailRow label="Harvest" value={kg(item.yieldKg)} />
              <DetailRow label="Yield" value={perHa(item)} />
              <DetailRow label={item.resubmittedAt ? "Resubmitted" : "Submitted"} value={fmtDateTime(filedAt(item))} />
              {!!item.reviewedAt && item.statusKey !== "submitted" && <DetailRow label="Reviewed" value={fmtDate(item.reviewedAt)} />}
              <DetailRow label="GPS location" value={hasGps ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : "Not recorded"} last />
            </View>
            {hasGps && (
              <TouchableOpacity
                style={styles.mapLink}
                onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`)}
                accessibilityRole="link"
              >
                <MapPin size={14} color={colors.primaryDark} />
                <Text style={styles.mapLinkText}>Open in Maps</Text>
              </TouchableOpacity>
            )}

            {item.statusKey === "returned" ? (
              <View style={styles.rejectionCallout}>
                <Text style={styles.calloutTitleRed}>MAO remarks</Text>
                <Text style={styles.calloutBody}>{item.reviewRemarks || "Please check the details and resubmit."}</Text>
                <TouchableOpacity style={styles.resubmitBtn} onPress={onResubmit} accessibilityRole="button" accessibilityLabel="Resubmit harvest report">
                  <RefreshCw size={13} color="#fff" />
                  <Text style={styles.resubmitText}>Resubmit</Text>
                </TouchableOpacity>
              </View>
            ) : item.reviewRemarks ? (
              <View style={styles.noteCallout}>
                <Text style={styles.calloutTitle}>Note from the Agriculture Office</Text>
                <Text style={styles.calloutBody}>{item.reviewRemarks}</Text>
              </View>
            ) : null}
            {!!item.remarks && (
              <View style={styles.noteCallout}>
                <Text style={styles.calloutTitle}>Your remarks</Text>
                <Text style={styles.calloutBody}>{item.remarks}</Text>
              </View>
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

// Same measurements as the Proof of Planting tab (ValidationScreen).
const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },

  submitCard: {
    minHeight: 120,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 11,
    paddingHorizontal: 16,
    marginBottom: 18,
    ...shadow({ color: colors.primaryDarker, y: 6, opacity: 0.22, radius: 12, elevation: 5 }),
  },
  submitCardPressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },
  submitIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  submitTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  submitSub: { color: "rgba(255,255,255,0.88)", fontSize: 11.5, marginTop: 3, textAlign: "center" },

  card: { ...tabCard, marginBottom: spacing.sm },
  cardPressed: { opacity: 0.9 },
  cardTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text },

  latestCard: { padding: 14, marginBottom: 18 },
  latestHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  latestDate: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  latestMeta: { fontSize: 11.5, color: colors.textMuted, marginTop: 3 },

  tracker: { flexDirection: "row", marginTop: 16 },
  step: { flex: 1, alignItems: "center" },
  connector: { position: "absolute", top: 13, height: 2, backgroundColor: colors.border },
  connectorLeft: { left: 0, right: "50%" },
  connectorRight: { left: "50%", right: 0 },
  connectorOn: { backgroundColor: colors.primary },
  stepCircle: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepNumber: { fontSize: 12, fontWeight: "700", color: colors.textFaint },
  stepLabel: { alignSelf: "stretch", fontSize: 10.5, color: colors.text, textAlign: "center", marginTop: 6, paddingHorizontal: 2, lineHeight: 14 },
  stepLabelCurrent: { fontWeight: "800", color: colors.orangeText },
  stepLabelRejected: { fontWeight: "800", color: colors.red },
  stepLabelTodo: { color: colors.textMuted },

  rejectRemarks: { fontSize: 12, color: colors.red, marginTop: 14, lineHeight: 17 },
  resubmitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: spacing.md,
    backgroundColor: colors.red,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  resubmitText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  historySummary: { fontSize: 11, color: colors.textMuted },
  historyCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  historyTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  historyCrop: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.text },
  historyLine: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  historyRejectRow: { marginTop: 4 },
  historyReject: { fontSize: 11, color: colors.red, lineHeight: 15 },
  resubmitLink: { fontSize: 11.5, fontWeight: "700", color: colors.red, textDecorationLine: "underline", marginTop: 3 },
  thumb: { width: 52, height: 52, borderRadius: radius.sm },
  thumbPlaceholder: { backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },

  emptyWrap: { alignItems: "center", gap: 8, paddingVertical: 28, paddingHorizontal: 24 },
  emptyText: { alignSelf: "stretch", fontSize: 12.5, color: colors.textMuted, textAlign: "center", lineHeight: 18 },
  skeleton: { backgroundColor: colors.grayBg, borderRadius: 6 },

  detail: { flex: 1, backgroundColor: colors.bg },
  detailBar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.header },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  detailContent: { padding: spacing.base, paddingBottom: 48 },
  detailPhoto: { width: "100%", height: 220, borderRadius: radius.md, marginBottom: 14 },
  noPhotoText: { fontSize: 11.5, color: colors.textMuted, marginTop: 6 },
  detailTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  detailTitle: { flex: 1, fontSize: 20, fontWeight: "800", color: colors.text },
  detailKvGroup: { marginTop: 18 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { width: "38%", fontSize: 11.5, color: colors.textMuted },
  detailValue: { flex: 1, fontSize: 12.5, color: colors.text, fontWeight: "600", textAlign: "right" },
  mapLink: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-end", paddingVertical: 8 },
  mapLinkText: { fontSize: 12, fontWeight: "700", color: colors.primaryDark },

  rejectionCallout: { marginTop: spacing.md, backgroundColor: colors.redBg, borderWidth: 1, borderColor: "#f3c6c6", borderRadius: radius.sm, padding: spacing.md },
  noteCallout: { marginTop: spacing.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md },
  calloutTitle: { fontSize: 11, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  calloutTitleRed: { fontSize: 11, fontWeight: "800", color: colors.red, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  calloutBody: { fontSize: 12.5, color: colors.text, lineHeight: 18 },

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
