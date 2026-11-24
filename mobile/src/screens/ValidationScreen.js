import { useCallback, useMemo, useState } from "react";
import { Image, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import { Check, Clock, FileText, MapPin, RefreshCw, Sprout, Wheat, X } from "lucide-react-native";
import TabScreenLayout, { PageTitle, tabCard } from "../components/TabScreenLayout";
import Pill from "../components/Pill";
import ErrorBanner from "../components/ui/ErrorBanner";
import Toast from "../components/ui/Toast";
import { colors, radius, shadow, spacing } from "../theme";
import { useAuth } from "../context/AuthContext";
import { getSignedPhotoUrl, listMyCropValidations } from "../lib/api/cropValidation";
import { getHarvestPhotoUrl, listMyHarvestReports } from "../lib/api/harvest";
import { useTabBarHeight } from "../hooks/useTabBarHeight";
import { formatDate as fmtDate, formatDateTime as fmtDateTime } from "../lib/dates";
import { friendlyError } from "../lib/friendlyError";
import { takeFlash } from "../lib/flash";
import { mapEmbedHtml } from "../lib/geotag";

// Validation tab: proof of planting and harvest reports together. Two action
// cards open the existing forms; "Latest submission" tracks the newest of
// either type; "My submissions" lists both (filter All / Planting /
// Harvest). Every submission opens full details (photo, map, details,
// remarks, timeline). A notification can open one directly
// (route.params.open = { kind, id }).

const FILTERS = [
  { value: "all", label: "All" },
  { value: "planting", label: "Planting" },
  { value: "harvest", label: "Harvest" },
];
const KIND_LABEL = { planting: "Planting", harvest: "Harvest" };
const fmt = (n) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
// "Sep 12" (this year) or "Sep 12, 2025".
function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "Asia/Manila" });
}

// Crop type and area for a planting submission: the linked farm crop when
// there is one, else what the farmer typed on the form (kept in their note
// while the submission is pending), else their registered commodity and farm
// size.
function plantingDetails(s, farmer) {
  const typed = s.status === "Pending" ? /^(.+?) · ([\d.]+) ha · planted (.+)$/.exec(s.remarks ?? "") : null;
  const known = (v) => (v && v !== "—" ? v : null);
  const crop = s.cropType ?? typed?.[1] ?? known(farmer?.primaryCommodity) ?? "Crop";
  const areaHa = s.areaPlanted != null ? s.areaPlanted : typed ? Number(typed[2]) : farmer?.farmSizeHa > 0 ? farmer.farmSizeHa : null;
  return { crop, areaHa, planted: typed?.[3] ?? null };
}

// Both kinds as one shape for the list, the tracker and the details.
function fromPlanting(s, farmer) {
  const d = plantingDetails(s, farmer);
  const area = d.areaHa != null ? `${fmt(Math.round(d.areaHa * 100) / 100)} ha` : null;
  const step = s.status === "Validated" ? `Validated ${shortDate(s.reviewedAt)}` : s.status === "Rejected" ? `Rejected ${shortDate(s.reviewedAt)}` : "Under review";
  return {
    key: `planting-${s.id}`,
    kind: "planting",
    id: s.id,
    crop: d.crop,
    date: s.submittedAt,
    stage: s.status === "Pending" ? "pending" : s.status === "Validated" ? "done" : "rejected",
    status: s.status,
    doneLabel: "Validated",
    rejectedLabel: "Rejected",
    summary: [area, step].filter(Boolean).join(" · "),
    latestMeta: [d.crop, area].filter(Boolean).join(" · "),
    // Once reviewed, the note on a submission is the reviewer's.
    reviewRemarks: s.status === "Pending" ? "" : s.remarks,
    farmerNote: s.status === "Pending" ? s.remarks : "",
    photoPath: s.photoPath,
    latitude: s.latitude,
    longitude: s.longitude,
    reviewedAt: s.reviewedAt,
    resubmittedAt: null,
    rows: [
      ["Submitted", fmtDateTime(s.submittedAt)],
      ["Crop", d.crop],
      ["Area planted", area],
      ["Planted", d.planted],
      ["Barangay", farmer?.barangay],
    ],
    raw: s,
    plantingIso: null,
  };
}

function fromHarvest(h) {
  const filed = h.resubmittedAt ?? h.createdAt;
  return {
    key: `harvest-${h.id}`,
    kind: "harvest",
    id: h.id,
    crop: h.crop || "Harvest",
    date: filed,
    stage: h.statusKey === "submitted" ? "pending" : h.statusKey === "verified" ? "done" : "rejected",
    status: h.status,
    doneLabel: "Verified",
    rejectedLabel: "Rejected",
    summary: [`${fmt(h.yieldKg)} kg`, h.harvestMonth].filter(Boolean).join(" · "),
    latestMeta: [h.crop, h.areaHa != null ? `${fmt(h.areaHa)} ha` : null, `${fmt(h.yieldKg)} kg`].filter(Boolean).join(" · "),
    reviewRemarks: h.reviewRemarks,
    farmerNote: h.remarks,
    photoPath: h.photoPath,
    latitude: h.latitude,
    longitude: h.longitude,
    reviewedAt: h.reviewedAt,
    resubmittedAt: h.resubmittedAt,
    rows: [
      ["Harvest date", fmtDate(h.harvestDate)],
      ["Crop", h.crop],
      ["Area harvested", h.areaHa != null ? `${fmt(h.areaHa)} ha` : null],
      ["Harvest", `${fmt(h.yieldKg)} kg`],
      ["Yield", h.yieldPerHa != null ? `${fmt(h.yieldPerHa)} kg/ha` : null],
      [h.resubmittedAt ? "Resubmitted" : "Submitted", fmtDateTime(filed)],
    ],
    raw: h,
    createdAt: h.createdAt,
  };
}

export default function ValidationScreen({ navigation, route }) {
  const { farmer } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const [items, setItems] = useState(null); // null while the first load runs
  const [thumbs, setThumbs] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(null); // item shown in the details sheet
  const [viewerUri, setViewerUri] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState({ visible: false, message: "", tone: "success" });

  // Refetched on every focus: the forms sit above this tab, so coming back
  // from one shows the new submission straight away.
  const load = useCallback(async () => {
    const [planting, harvest] = await Promise.allSettled([listMyCropValidations(), listMyHarvestReports()]);
    const list = [
      ...(planting.status === "fulfilled" ? planting.value.map((s) => fromPlanting(s, farmer)) : []),
      ...(harvest.status === "fulfilled" ? harvest.value.map(fromHarvest) : []),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    const failed = [planting, harvest].find((r) => r.status === "rejected");
    setLoadError(failed ? friendlyError(failed.reason, "Your submissions couldn't be loaded. Please try again.") : "");
    setItems((prev) => (failed && !list.length ? prev ?? [] : list));
    setRefreshing(false);
    for (const i of list) {
      if (!i.photoPath) continue;
      (i.kind === "planting" ? getSignedPhotoUrl(i.photoPath) : getHarvestPhotoUrl(i.photoPath))
        .then((url) => url && setThumbs((prev) => ({ ...prev, [i.key]: url })))
        .catch(() => {});
    }
    return list;
  }, [farmer]);

  useFocusEffect(
    useCallback(() => {
      const flash = takeFlash();
      if (flash) setToast({ visible: true, message: flash.message, tone: flash.tone });
      const want = route?.params?.open;
      load().then((list) => {
        if (!want) return;
        const hit = list.find((i) => i.kind === want.kind && String(i.id) === String(want.id));
        if (hit) setOpen(hit);
        else setFilter(want.kind === "planting" || want.kind === "harvest" ? want.kind : "all");
        navigation.setParams({ open: undefined });
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, route?.params?.open])
  );

  const resubmit = (item) => {
    setOpen(null);
    if (item.kind === "harvest") navigation.navigate("HarvestReport", { report: item.raw });
    else {
      const d = plantingDetails(item.raw, farmer);
      navigation.navigate("CropValidation", { resubmit: { cropType: item.raw.cropType ?? d.crop, areaHa: d.areaHa, plantingIso: null, remarks: item.reviewRemarks } });
    }
  };

  const latest = items?.[0] ?? null;
  const shown = useMemo(() => (items ?? []).filter((i) => filter === "all" || i.kind === filter), [items, filter]);
  const counts = useMemo(() => ({ all: items?.length ?? 0, planting: items?.filter((i) => i.kind === "planting").length ?? 0, harvest: items?.filter((i) => i.kind === "harvest").length ?? 0 }), [items]);

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
        <PageTitle>Validation</PageTitle>

        {!!loadError && <ErrorBanner message={loadError} onRetry={load} />}

        <View style={styles.actions}>
          <ActionCard
            color={ACTION_PLANTING}
            label="Submit proof of planting"
            title="Proof of Planting"
            icon={<MaterialCommunityIcons name="camera-plus-outline" size={22} color="#fff" />}
            onPress={() => navigation.navigate("CropValidation")}
          />
          <ActionCard
            color={ACTION_HARVEST}
            label="Submit harvest report"
            title="Report Harvest"
            icon={<Wheat size={21} color="#fff" />}
            onPress={() => navigation.navigate("HarvestReport")}
          />
        </View>

        {items === null ? (
          <LoadingSkeleton />
        ) : !latest ? (
          <View style={styles.emptyWrap}>
            <FileText size={28} color={colors.iconFaint} />
            <Text style={styles.emptyText}>You haven't submitted anything yet.</Text>
          </View>
        ) : (
          <>
            <LatestSubmission item={latest} onOpen={() => setOpen(latest)} onResubmit={() => resubmit(latest)} />

            <Text style={styles.sectionTitle}>My submissions</Text>
            <View style={styles.chips} accessibilityRole="tablist">
              {FILTERS.map((f) => {
                const on = filter === f.value;
                return (
                  <TouchableOpacity
                    key={f.value}
                    onPress={() => setFilter(f.value)}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${f.label}, ${counts[f.value]}`}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
                    <Text style={[styles.chipCount, on && styles.chipTextOn]}>{counts[f.value]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {shown.length === 0 ? (
              <Text style={styles.filterEmpty}>{filter === "planting" ? "No proof of planting submitted yet." : "No harvest reported yet."}</Text>
            ) : (
              shown.map((item) => <SubmissionCard key={item.key} item={item} thumb={thumbs[item.key]} onOpen={() => setOpen(item)} onResubmit={() => resubmit(item)} />)
            )}
          </>
        )}
      </ScrollView>

      <SubmissionDetails item={open} photo={open ? thumbs[open.key] : null} onClose={() => setOpen(null)} onViewPhoto={setViewerUri} onResubmit={() => resubmit(open)} />

      {/* The photo already carries the geotag stamp from the capture screen. */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <TouchableOpacity style={styles.viewerBackdrop} activeOpacity={1} onPress={() => setViewerUri(null)}>
          <TouchableOpacity style={styles.viewerCloseBtn} onPress={() => setViewerUri(null)} accessibilityLabel="Close photo">
            <X size={22} color="#fff" />
          </TouchableOpacity>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>

      <Toast visible={toast.visible} message={toast.message} tone={toast.tone} onDone={() => setToast((t) => ({ ...t, visible: false }))} />
    </TabScreenLayout>
  );
}

const ACTION_PLANTING = "#2F9E44";
const ACTION_HARVEST = "#1F7A34";

function ActionCard({ color, title, label, icon, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.action, { backgroundColor: color }, pressed && styles.actionPressed]}
    >
      <View style={styles.actionIcon}>{icon}</View>
      <Text style={styles.actionTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {title}
      </Text>
    </Pressable>
  );
}

function KindTag({ kind }) {
  return (
    <View style={[styles.tag, kind === "harvest" ? styles.tagHarvest : styles.tagPlanting]}>
      <Text style={[styles.tagText, kind === "harvest" ? styles.tagTextHarvest : styles.tagTextPlanting]}>{KIND_LABEL[kind]}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Latest submission: Submitted -> Under review -> Validated / Verified
// ---------------------------------------------------------------------------
function LatestSubmission({ item, onOpen, onResubmit }) {
  const rejected = item.stage === "rejected";
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Latest submission, ${KIND_LABEL[item.kind]}, ${item.crop}, ${item.stage === "pending" ? "under review" : item.status.toLowerCase()}. Open details`}
      style={({ pressed }) => [styles.card, styles.latestCard, pressed && styles.cardPressed]}
    >
      <View style={styles.latestHeader}>
        <View style={styles.latestTitleRow}>
          <Text style={styles.cardTitle}>Latest submission</Text>
          <KindTag kind={item.kind} />
        </View>
        <Text style={styles.latestDate}>{fmtDate(item.date)}</Text>
      </View>
      <Text style={styles.latestMeta} numberOfLines={2}>{item.latestMeta}</Text>

      <StatusTracker item={item} />

      {rejected && (
        <>
          <Text style={styles.rejectRemarks}>{item.reviewRemarks || "No reason was provided."}</Text>
          <TouchableOpacity style={styles.resubmitBtn} onPress={onResubmit} accessibilityRole="button" accessibilityLabel={`Resubmit ${item.kind === "harvest" ? "harvest report" : "proof of planting"}`}>
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

function StatusTracker({ item }) {
  const { stage } = item;
  const steps = [
    { label: "Submitted", state: "done" },
    { label: "Under review", state: stage === "pending" ? "current" : "done" },
    {
      label: stage === "done" ? `${item.doneLabel} on ${fmtDate(item.reviewedAt)}` : stage === "rejected" ? item.rejectedLabel : item.doneLabel,
      state: stage === "done" ? "done" : stage === "rejected" ? "rejected" : "todo",
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
            <Text style={[styles.stepLabel, step.state === "current" && styles.stepLabelCurrent, step.state === "rejected" && styles.stepLabelRejected, step.state === "todo" && styles.stepLabelTodo]}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// My submissions
// ---------------------------------------------------------------------------
function SubmissionCard({ item, thumb, onOpen, onResubmit }) {
  const Placeholder = item.kind === "harvest" ? Wheat : Sprout;
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${KIND_LABEL[item.kind]}, ${item.crop}, ${item.summary}, ${item.status}. Open details`}
      style={({ pressed }) => [styles.card, styles.itemCard, pressed && styles.cardPressed]}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Placeholder size={18} color={colors.primaryDark} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <View style={styles.itemTop}>
          <Text style={styles.itemCrop} numberOfLines={1}>{item.crop}</Text>
          <Pill status={item.status} />
        </View>
        <View style={styles.itemLine}>
          <KindTag kind={item.kind} />
          <Text style={styles.itemSummary} numberOfLines={1}>{item.summary}</Text>
        </View>
        {item.stage === "rejected" && (
          <View style={styles.itemRejectRow}>
            <Text style={styles.itemReject} numberOfLines={2}>{item.reviewRemarks || "No reason was provided."}</Text>
            <TouchableOpacity onPress={onResubmit} accessibilityRole="link" accessibilityLabel={`Resubmit ${item.kind === "harvest" ? "harvest report" : "proof of planting"}`} hitSlop={10}>
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
    <View accessibilityLabel="Loading submissions">
      <View style={[styles.card, styles.latestCard]}>
        <View style={[styles.skeleton, { width: "45%", height: 13 }]} />
        <View style={[styles.skeleton, { width: "65%", height: 10, marginTop: 8 }]} />
        <View style={[styles.skeleton, { width: "100%", height: 46, marginTop: 16 }]} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.card, styles.itemCard]}>
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
// Full details: photo, map location, details, remarks, timeline
// ---------------------------------------------------------------------------
function timelineOf(item) {
  const events = [{ label: "Submitted", at: item.kind === "harvest" ? item.createdAt : item.date, tone: "done" }];
  if (item.reviewedAt && item.stage !== "pending") events.push({ label: item.stage === "done" ? `${item.doneLabel} by the MAO` : `${item.rejectedLabel} by the MAO`, at: item.reviewedAt, tone: item.stage === "done" ? "done" : "rejected" });
  if (item.resubmittedAt) {
    if (item.reviewedAt && item.stage === "pending") events.push({ label: `${item.rejectedLabel} by the MAO`, at: item.reviewedAt, tone: "rejected" });
    events.push({ label: "Corrected and resubmitted", at: item.resubmittedAt, tone: "done" });
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  if (item.stage === "pending") events.push({ label: "Waiting for the MAO's review", at: null, tone: "current" });
  return events;
}

function SubmissionDetails({ item, photo, onClose, onViewPhoto, onResubmit }) {
  const hasGps = item?.latitude != null && item?.longitude != null;
  const Placeholder = item?.kind === "harvest" ? Wheat : Sprout;
  return (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose}>
      {item && (
        <View style={styles.detail}>
          <View style={styles.detailBar}>
            <KindTag kind={item.kind} />
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
                <Placeholder size={30} color={colors.primaryDark} />
                <Text style={styles.noPhotoText}>No photo added</Text>
              </View>
            )}

            <View style={styles.detailTitleRow}>
              <Text style={styles.detailTitle}>{item.crop}</Text>
              <Pill status={item.status} />
            </View>
            <StatusTracker item={item} />

            {item.stage === "rejected" ? (
              <View style={styles.rejectionCallout}>
                <Text style={styles.calloutTitleRed}>{item.kind === "harvest" ? "MAO remarks" : "Reason for rejection"}</Text>
                <Text style={styles.calloutBody}>{item.reviewRemarks || "No reason was provided."}</Text>
                <TouchableOpacity style={styles.resubmitBtn} onPress={onResubmit} accessibilityRole="button" accessibilityLabel={`Resubmit ${item.kind === "harvest" ? "harvest report" : "proof of planting"}`}>
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

            <Text style={styles.detailSection}>Details</Text>
            <View>
              {item.rows.filter(([, v]) => v).map(([label, value], i, all) => (
                <DetailRow key={label} label={label} value={value} last={i === all.length - 1} />
              ))}
            </View>

            <Text style={styles.detailSection}>Location</Text>
            {hasGps ? (
              <>
                {Platform.OS !== "web" && (
                  <View style={styles.mapWrap}>
                    <WebView source={{ html: mapEmbedHtml(item.latitude, item.longitude) }} style={styles.map} />
                  </View>
                )}
                <View style={styles.gpsRow}>
                  <Text style={styles.gpsText}>{item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}</Text>
                  <TouchableOpacity
                    style={styles.mapLink}
                    onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`)}
                    accessibilityRole="link"
                  >
                    <MapPin size={14} color={colors.primaryDark} />
                    <Text style={styles.mapLinkText}>Open in Maps</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <Text style={styles.muted}>No GPS location recorded.</Text>
            )}

            {!!item.farmerNote && (
              <View style={styles.noteCallout}>
                <Text style={styles.calloutTitle}>Your remarks</Text>
                <Text style={styles.calloutBody}>{item.farmerNote}</Text>
              </View>
            )}

            <Text style={styles.detailSection}>Timeline</Text>
            <View style={styles.timeline}>
              {timelineOf(item).map((e, i) => (
                <View key={i} style={styles.tlRow}>
                  <View style={[styles.tlDot, { backgroundColor: e.tone === "rejected" ? colors.red : e.tone === "current" ? colors.orange : colors.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tlLabel}>{e.label}</Text>
                    {!!e.at && <Text style={styles.tlDate}>{fmtDateTime(e.at)}</Text>}
                  </View>
                </View>
              ))}
            </View>
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
  content: { padding: 16, paddingBottom: 32 },

  actions: { flexDirection: "row", gap: 12, marginBottom: 18 },
  action: {
    flex: 1,
    height: 96,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    ...shadow({ color: colors.primaryDarker, y: 5, opacity: 0.2, radius: 10, elevation: 4 }),
  },
  actionPressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  actionTitle: { color: "#fff", fontSize: 14, fontWeight: "800", textAlign: "center", alignSelf: "stretch" },

  card: { ...tabCard, marginBottom: spacing.sm },
  cardPressed: { opacity: 0.9 },
  cardTitle: { fontSize: 13.5, fontWeight: "700", color: colors.text },

  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1.5 },
  tagPlanting: { backgroundColor: "#def2f0" },
  tagHarvest: { backgroundColor: colors.purpleBg },
  tagText: { fontSize: 10, fontWeight: "700" },
  tagTextPlanting: { color: "#0b665c" },
  tagTextHarvest: { color: colors.purple },

  latestCard: { padding: 14, marginBottom: 18 },
  latestHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  latestTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
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

  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: 8 },
  chips: { flexDirection: "row", gap: 8, marginBottom: 10 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12.5, fontWeight: "700", color: colors.textSecondary },
  chipCount: { fontSize: 11, fontWeight: "700", color: colors.textMuted },
  chipTextOn: { color: "#fff" },
  filterEmpty: { fontSize: 12.5, color: colors.textMuted, textAlign: "center", paddingVertical: 18 },

  itemCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  itemTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  itemCrop: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.text },
  itemLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  itemSummary: { flex: 1, fontSize: 11, color: colors.textMuted },
  itemRejectRow: { marginTop: 4 },
  itemReject: { fontSize: 11, color: colors.red, lineHeight: 15 },
  resubmitLink: { fontSize: 11.5, fontWeight: "700", color: colors.red, textDecorationLine: "underline", marginTop: 3 },
  thumb: { width: 52, height: 52, borderRadius: radius.sm },
  thumbPlaceholder: { backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },

  emptyWrap: { alignItems: "center", gap: 8, paddingVertical: 28, paddingHorizontal: 24 },
  emptyText: { alignSelf: "stretch", fontSize: 12.5, color: colors.textMuted, textAlign: "center", lineHeight: 18 },
  skeleton: { backgroundColor: colors.grayBg, borderRadius: 6 },

  detail: { flex: 1, backgroundColor: colors.bg },
  detailBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.header },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  detailContent: { padding: spacing.base, paddingBottom: 48 },
  detailPhoto: { width: "100%", height: 220, borderRadius: radius.md, marginBottom: 14 },
  noPhotoText: { fontSize: 11.5, color: colors.textMuted, marginTop: 6 },
  detailTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  detailTitle: { flex: 1, fontSize: 20, fontWeight: "800", color: colors.text },
  detailSection: { fontSize: 11, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 20, marginBottom: 4 },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { width: "38%", fontSize: 11.5, color: colors.textMuted },
  detailValue: { flex: 1, fontSize: 12.5, color: colors.text, fontWeight: "600", textAlign: "right" },
  mapWrap: { height: 160, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: colors.border, marginTop: 6 },
  map: { flex: 1 },
  gpsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 6 },
  gpsText: { fontSize: 12, color: colors.text, fontWeight: "600" },
  mapLink: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 8 },
  mapLinkText: { fontSize: 12, fontWeight: "700", color: colors.primaryDark },
  muted: { fontSize: 12, color: colors.textMuted, paddingVertical: 6 },

  rejectionCallout: { marginTop: spacing.md, backgroundColor: colors.redBg, borderWidth: 1, borderColor: "#f3c6c6", borderRadius: radius.sm, padding: spacing.md },
  noteCallout: { marginTop: spacing.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md },
  calloutTitle: { fontSize: 11, fontWeight: "800", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  calloutTitleRed: { fontSize: 11, fontWeight: "800", color: colors.red, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 },
  calloutBody: { fontSize: 12.5, color: colors.text, lineHeight: 18 },

  timeline: { marginTop: 6, gap: 10 },
  tlRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  tlDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  tlLabel: { fontSize: 12.5, color: colors.text, fontWeight: "600" },
  tlDate: { fontSize: 11, color: colors.textMuted, marginTop: 1 },

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
