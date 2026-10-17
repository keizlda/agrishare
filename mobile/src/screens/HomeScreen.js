import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { CheckCircle2, ChevronRight, Leaf, Megaphone, Package, Pin } from "lucide-react-native";
import TabScreenLayout, { tabCard } from "../components/TabScreenLayout";
import AnnouncementDetailModal from "../components/AnnouncementDetailModal";
import Avatar from "../components/Avatar";
import Pill from "../components/Pill";
import ReminderBanner from "../components/ReminderBanner";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listMyDistributions } from "../lib/api/distributions";
import { listAnnouncements, markAnnouncementRead } from "../lib/api/announcements";
import { useTabBarHeight } from "../hooks/useTabBarHeight";

const ANNOUNCEMENT_ROWS = 3;

// Completed -> "Received" (they got it); Ongoing -> "Upcoming" (scheduled
// or in progress). Farmers never see acknowledgement wording.
function recentBadge(status) {
  if (status === "Completed") return "Received";
  if (status === "Ongoing") return "Upcoming";
  return status;
}

// "Oct 23 · 9:00 AM · Langapud Covered Court" for distribution posts, the
// first line of the details for general notices.
function announcementLine(a) {
  if (a.isGeneralNotice) return (a.body ?? "").split("\n").find((l) => l.trim()) ?? "";
  const date = a.distributionDate
    ? new Date(`${a.distributionDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;
  let time = null;
  if (a.distributionTime) {
    const [h, m] = a.distributionTime.split(":").map(Number);
    time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  return [date, time, a.venue].filter(Boolean).join(" · ");
}

export default function HomeScreen({ navigation }) {
  const { farmer } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const [distributions, setDistributions] = useState([]);
  const [announcements, setAnnouncements] = useState(null); // null while loading
  const [openAnnouncement, setOpenAnnouncement] = useState(null);

  // Refetched on every focus so read dots and new posts are current after
  // coming back from the Announcements screen or another tab.
  useFocusEffect(
    useCallback(() => {
      listMyDistributions().then(setDistributions).catch(() => {});
      listAnnouncements()
        .then(setAnnouncements)
        .catch(() => setAnnouncements((prev) => prev ?? []));
    }, [])
  );

  const recent = distributions.slice(0, 3);
  // Pinned first, then newest (listAnnouncements' order).
  const latestAnnouncements = (announcements ?? []).slice(0, ANNOUNCEMENT_ROWS);
  const taggedEventIds = new Set(distributions.map((d) => d.id));

  function openPost(a) {
    setOpenAnnouncement(a);
    if (!a.read && farmer?.farmerId) {
      setAnnouncements((prev) => prev?.map((x) => (x.id === a.id ? { ...x, read: true } : x)) ?? prev);
      markAnnouncementRead(a.id, farmer.farmerId).catch(() => {
        setAnnouncements((prev) => prev?.map((x) => (x.id === a.id ? { ...x, read: false } : x)) ?? prev);
      });
    }
  }

  return (
    <TabScreenLayout navigation={navigation}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 16 }]}>
        <View style={styles.welcomeRow}>
          {/* Keyed by uri so a new upload shows immediately (see Avatar.js). */}
          <Avatar uri={farmer?.avatarUrl} size={48} key={farmer?.avatarUrl ?? "none"} />
          <Text style={styles.welcome}>Welcome Back, {farmer?.firstName}!</Text>
        </View>

        {farmer?.mustChangePassword && (
          <ReminderBanner
            text="You're using the default password. Change it to keep your account secure."
            actionLabel="Change Password"
            onPress={() => navigation.navigate("ChangePassword")}
          />
        )}

        <TouchableOpacity style={[styles.requestCard, farmer?.mustChangePassword && { marginTop: 12 }]} onPress={() => navigation.navigate("Requests")}>
          <View style={styles.requestIcon}>
            <Package size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.requestTitle}>Request Commodity</Text>
            <Text style={styles.requestSub}>Submit a request for seeds, fertilizer, or tools</Text>
          </View>
          <ChevronRight size={16} color={colors.primaryDark} />
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Announcements</Text>
          <TouchableOpacity onPress={() => navigation.navigate("Announcements")} style={styles.viewAllRow} accessibilityRole="link">
            <Text style={styles.viewAll}>View all</Text>
            <ChevronRight size={13} color={colors.primaryDark} />
          </TouchableOpacity>
        </View>
        <View style={[styles.card, styles.sectionCard]}>
          {announcements === null ? (
            [0, 1].map((i) => (
              <View key={i} style={[styles.annRow, i === 1 && styles.lastRow]}>
                <View style={[styles.annIcon, styles.skeleton]} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={[styles.skeleton, { height: 11, width: "70%" }]} />
                  <View style={[styles.skeleton, { height: 9, width: "45%" }]} />
                </View>
              </View>
            ))
          ) : latestAnnouncements.length === 0 ? (
            <Text style={styles.emptyText}>No announcements yet.</Text>
          ) : (
            latestAnnouncements.map((a, i) => {
              const Icon = a.isPinned ? Pin : Megaphone;
              const included = !!a.linkedDistributionId && taggedEventIds.has(a.linkedDistributionId);
              const line = announcementLine(a);
              return (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.annRow, i === latestAnnouncements.length - 1 && styles.lastRow]}
                  onPress={() => openPost(a)}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.isPinned ? "Pinned. " : ""}${a.title}${a.read ? "" : ". Unread"}`}
                >
                  <View style={styles.annIcon}>
                    <Icon size={16} color={colors.primaryDark} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.annTitle} numberOfLines={1}>{a.title}</Text>
                    {!!line && <Text style={styles.annSub} numberOfLines={1}>{line}</Text>}
                    {included && (
                      <View style={styles.includedRow}>
                        <CheckCircle2 size={12} color={colors.primary} />
                        <Text style={styles.includedText}>You're included</Text>
                      </View>
                    )}
                  </View>
                  {!a.read && <View style={styles.unreadDot} accessibilityLabel="Unread" />}
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Distributions</Text>
          {distributions.length > 0 && (
            <TouchableOpacity onPress={() => navigation.navigate("MyDistributions")} style={styles.viewAllRow}>
              <Text style={styles.viewAll}>View All</Text>
              <ChevronRight size={13} color={colors.primaryDark} />
            </TouchableOpacity>
          )}
        </View>

        {recent.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>You haven't been tagged in a distribution yet.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            {recent.map((d, i) => (
              <View key={d.claimId} style={[styles.distRow, i === recent.length - 1 && styles.lastRow]}>
                <View style={styles.distIcon}>
                  <Leaf size={16} color={colors.primaryDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.distTitle}>{d.program}</Text>
                  <Text style={styles.distSub}>
                    {d.date} · {d.venue} · {d.item} · {d.quantity.toLocaleString()} {d.unit}
                  </Text>
                </View>
                <Pill status={recentBadge(d.status)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <AnnouncementDetailModal announcement={openAnnouncement} onClose={() => setOpenAnnouncement(null)} />
    </TabScreenLayout>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  welcomeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  welcome: { flex: 1, fontSize: 19, fontWeight: "800", color: colors.text },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4, marginBottom: 8 },
  viewAllRow: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 4 },
  viewAll: { fontSize: 11.5, color: colors.primaryDark, fontWeight: "600" },
  emptyText: { fontSize: 11.5, color: colors.textMuted, padding: 14, textAlign: "center" },

  requestCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 18,
  },
  requestIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  requestTitle: { fontSize: 13.5, fontWeight: "700", color: colors.primaryDarker },
  requestSub: { fontSize: 10.5, color: colors.primaryDark, marginTop: 2 },

  card: { ...tabCard, padding: 4, marginBottom: 8 },
  sectionCard: { marginBottom: 18 },
  lastRow: { borderBottomWidth: 0 },

  annRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  annIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  annTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  annSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
  includedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  includedText: { fontSize: 10.5, fontWeight: "700", color: colors.primary },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  skeleton: { backgroundColor: colors.grayBg, borderRadius: 6 },

  distRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  distIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  distTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  distSub: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
});
