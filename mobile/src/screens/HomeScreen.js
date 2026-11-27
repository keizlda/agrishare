import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ChevronRight, Leaf, Package } from "lucide-react-native";
import TabScreenLayout, { tabCard } from "../components/TabScreenLayout";
import PostCard from "../components/PostCard";
import Avatar from "../components/Avatar";
import Pill from "../components/Pill";
import ReminderBanner from "../components/ReminderBanner";
import ErrorBanner from "../components/ui/ErrorBanner";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listMyDistributions } from "../lib/api/distributions";
import { listAnnouncements, markAnnouncementRead } from "../lib/api/announcements";
import { useTabBarHeight } from "../hooks/useTabBarHeight";
import { formatDate } from "../lib/dates";
import { friendlyError } from "../lib/friendlyError";

const ANNOUNCEMENT_ROWS = 3;

// Completed -> "Received" (they got it); Ongoing -> "Upcoming" (scheduled
// or in progress). Farmers never see acknowledgement wording.
function recentBadge(status) {
  if (status === "Completed") return "Received";
  if (status === "Ongoing") return "Upcoming";
  return status;
}

export default function HomeScreen({ navigation }) {
  const { farmer } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const [distributions, setDistributions] = useState([]);
  const [announcements, setAnnouncements] = useState(null); // null while loading
  // Shown with Try again when either list fails to load (instead of empty
  // lists that would read as "no distributions").
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [mine, posts] = await Promise.allSettled([listMyDistributions(), listAnnouncements()]);
    if (mine.status === "fulfilled") setDistributions(mine.value);
    if (posts.status === "fulfilled") setAnnouncements(posts.value);
    else setAnnouncements((prev) => prev ?? []);
    const failed = [mine, posts].find((r) => r.status === "rejected");
    setLoadError(failed ? friendlyError(failed.reason, "Some of your information couldn't be loaded. Please try again.") : "");
  }, []);

  // Refetched on every focus so read dots and new posts are current after
  // coming back from the Announcements screen or another tab.
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

  const recent = distributions.slice(0, 3);
  // Pinned first, then newest (listAnnouncements' order).
  const latestAnnouncements = (announcements ?? []).slice(0, ANNOUNCEMENT_ROWS);

  // Opens the post's details screen (and marks it read).
  function openPost(a) {
    navigation.navigate("AnnouncementDetail", { post: { ...a, read: true } });
    if (!a.read && farmer?.farmerId) {
      setAnnouncements((prev) => prev?.map((x) => (x.id === a.id ? { ...x, read: true } : x)) ?? prev);
      markAnnouncementRead(a.id, farmer.farmerId).catch(() => {
        setAnnouncements((prev) => prev?.map((x) => (x.id === a.id ? { ...x, read: false } : x)) ?? prev);
      });
    }
  }

  return (
    <TabScreenLayout navigation={navigation}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 16 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >
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

        {!!loadError && <ErrorBanner message={loadError} onRetry={load} style={{ marginTop: 12, marginBottom: 0 }} />}

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
        {/* The latest posts as full cards, as on the website: the seal,
            when it was posted, Pinned, the title, the date / time / venue
            box, the details, the photo and who it's for. */}
        <View style={styles.sectionCard}>
          {announcements === null ? (
            [0, 1].map((i) => (
              <View key={i} style={styles.postSkeleton}>
                <View style={styles.skeletonHead}>
                  <View style={[styles.skeleton, styles.skeletonAvatar]} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={[styles.skeleton, { height: 11, width: "40%" }]} />
                    <View style={[styles.skeleton, { height: 9, width: "30%" }]} />
                  </View>
                </View>
                <View style={[styles.skeleton, { height: 13, width: "75%", marginBottom: 8 }]} />
                <View style={[styles.skeleton, { height: 28, width: "100%" }]} />
              </View>
            ))
          ) : latestAnnouncements.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyText}>No announcements yet.</Text>
            </View>
          ) : (
            latestAnnouncements.map((a) => <PostCard key={a.id} post={a} unread={!a.read} onOpen={openPost} />)
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
              // Tapping a distribution opens its details (My Distributions).
              <TouchableOpacity
                key={d.claimId}
                activeOpacity={0.7}
                onPress={() => navigation.navigate("MyDistributions", { claimId: d.claimId })}
                style={[styles.distRow, i === recent.length - 1 && styles.lastRow]}
                accessibilityRole="button"
                accessibilityLabel={`${d.program}, ${formatDate(d.date)}. Open details`}
              >
                <View style={styles.distIcon}>
                  <Leaf size={16} color={colors.primaryDark} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.distTitle}>{d.program}</Text>
                  <Text style={styles.distSub}>
                    {formatDate(d.date)} · {d.venue} · {d.item} · {d.quantity.toLocaleString()} {d.unit}
                  </Text>
                </View>
                <Pill status={recentBadge(d.status)} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

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
  emptyText: { alignSelf: "stretch", fontSize: 11.5, color: colors.textMuted, padding: 14, textAlign: "center" },

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

  postSkeleton: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 10,
  },
  skeletonHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  skeletonAvatar: { width: 38, height: 38, borderRadius: 19 },
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
