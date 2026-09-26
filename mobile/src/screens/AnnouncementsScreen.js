import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { Megaphone, Pin, X } from "lucide-react-native";
import ScreenHeader from "../components/ScreenHeader";
import EmptyState from "../components/ui/EmptyState";
import { colors, radius, spacing } from "../theme";
import { useAuth } from "../context/AuthContext";
import { getAnnouncementImageUrl, listAnnouncements, markAnnouncementRead, subscribeToAnnouncements } from "../lib/api/announcements";
import { deleteNotification, listMyNotifications, markAllNotificationsRead, markNotificationRead } from "../lib/api/userNotifications";

const UPDATES_TAB = "My Updates";
const TABS = ["Announcements", "Unread", UPDATES_TAB];

// Urgent = red; the rest are green / neutral (Validation Reminder matches the
// web admin's blue chip).
const CATEGORY_STYLE = {
  Urgent: { fg: colors.red, bg: colors.redBg, icon: "alert-circle" },
  "Distribution Schedule": { fg: colors.primaryDark, bg: colors.primaryLight, icon: "calendar-outline" },
  "Validation Reminder": { fg: colors.blue, bg: colors.blueBg, icon: "shield-checkmark-outline" },
  General: { fg: colors.gray, bg: colors.grayBg, icon: "megaphone-outline" },
};

// type -> Ionicons name + color, matching the web bell (validated=green check,
// rejected=red x, request=inbox).
const UPDATE_ICONS = {
  validated: { name: "checkmark-circle", color: colors.primaryDark, bg: colors.primaryLight },
  rejected: { name: "close-circle", color: colors.red, bg: colors.redBg },
  request: { name: "file-tray-outline", color: colors.purple, bg: colors.purpleBg },
  distribution: { name: "cube-outline", color: colors.orange, bg: colors.orangeBg },
  system: { name: "notifications-outline", color: colors.gray, bg: colors.grayBg },
};

function CategoryBadge({ category }) {
  const s = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.General;
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Ionicons name={s.icon} size={11} color={s.fg} />
      <Text style={[styles.badgeText, { color: s.fg }]}>{category}</Text>
    </View>
  );
}

export default function AnnouncementsScreen({ navigation }) {
  const { farmer } = useAuth();
  const farmerId = farmer?.farmerId;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(TABS[0]);
  const [updates, setUpdates] = useState([]);
  const [open, setOpen] = useState(null); // announcement shown in the detail sheet
  const [openImage, setOpenImage] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems(await listAnnouncements());
      setError("");
    } catch {
      setError("Couldn't load announcements. Pull down to try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch every time the screen is focused (covers unpublish/delete, which
  // realtime can't report for rows the farmer can no longer see) and live
  // whenever a post is added or changed while the screen is open.
  useFocusEffect(
    useCallback(() => {
      load();
      listMyNotifications().then(setUpdates).catch(() => {});
    }, [load])
  );

  useEffect(() => subscribeToAnnouncements(load), [load]);

  function onRefresh() {
    setRefreshing(true);
    load();
    listMyNotifications().then(setUpdates).catch(() => {});
  }

  function openAnnouncement(a) {
    setOpen(a);
    setOpenImage(null);
    if (a.imagePath) getAnnouncementImageUrl(a.imagePath).then(setOpenImage).catch(() => {});
    if (!a.read && farmerId) {
      setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
      markAnnouncementRead(a.id, farmerId).catch(() => {
        setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, read: false } : x)));
      });
    }
  }

  const unreadCount = items.filter((a) => !a.read).length;
  const filtered = useMemo(() => (tab === "Unread" ? items.filter((a) => !a.read) : items), [items, tab]);

  const unreadUpdates = updates.filter((u) => !u.isRead).length;

  async function openUpdate(u) {
    if (!u.isRead) {
      setUpdates((prev) => prev.map((x) => (x.id === u.id ? { ...x, isRead: true } : x)));
      markNotificationRead(u.id).catch(() => {});
    }
    if (u.type === "validated" || u.type === "rejected") navigation.navigate("MainTabs", { screen: "Validation" });
    else if (u.type === "request") navigation.navigate("Requests");
  }

  function removeUpdate(id) {
    const snapshot = updates;
    setUpdates((prev) => prev.filter((x) => x.id !== id));
    deleteNotification(id).catch(() => setUpdates(snapshot));
  }

  function markAllUpdatesRead() {
    const snapshot = updates;
    setUpdates((prev) => prev.map((x) => ({ ...x, isRead: true })));
    markAllNotificationsRead().catch(() => setUpdates(snapshot));
  }

  function tabLabel(t) {
    if (t === UPDATES_TAB && unreadUpdates > 0) return `${t} (${unreadUpdates > 9 ? "9+" : unreadUpdates})`;
    if (t === "Unread" && unreadCount > 0) return `${t} (${unreadCount > 9 ? "9+" : unreadCount})`;
    return t;
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Announcements" onBack={() => navigation.goBack()} />

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{tabLabel(t)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === UPDATES_TAB ? (
        <FlatList
          data={updates}
          keyExtractor={(u) => String(u.id)}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            unreadUpdates > 0 ? (
              <TouchableOpacity onPress={markAllUpdatesRead} style={styles.markAllBtn}>
                <Text style={styles.markAllText}>Mark all as read</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item: u }) => {
            const icon = UPDATE_ICONS[u.type] ?? UPDATE_ICONS.system;
            return (
              <TouchableOpacity activeOpacity={0.7} onPress={() => openUpdate(u)} style={[styles.card, !u.isRead && styles.cardUnread]}>
                <View style={[styles.iconWrap, { backgroundColor: icon.bg }]}>
                  <Ionicons name={icon.name} size={18} color={icon.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.date}>{new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
                    {!u.isRead && <View style={styles.unreadDot} />}
                  </View>
                  <Text style={[styles.title, !u.isRead && { fontWeight: "800" }]}>{u.title}</Text>
                  <Text style={styles.body} numberOfLines={3}>{u.message}</Text>
                </View>
                <TouchableOpacity onPress={() => removeUpdate(u.id)} style={styles.archiveBtn} accessibilityLabel="Delete update">
                  <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>You're all caught up.</Text>}
        />
      ) : loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(a) => String(a.id)}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={error ? <Text style={styles.errorText}>{error}</Text> : null}
          renderItem={({ item: a }) => (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => openAnnouncement(a)}
              style={[styles.card, styles.annCard, !a.read && styles.cardUnread, a.category === "Urgent" && styles.cardUrgent]}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.rowBetween}>
                  <View style={styles.badgeRow}>
                    <CategoryBadge category={a.category} />
                    {a.isPinned && (
                      <View style={styles.pinned}>
                        <Pin size={11} color={colors.primaryDark} />
                        <Text style={styles.pinnedText}>Pinned</Text>
                      </View>
                    )}
                  </View>
                  {!a.read && <View style={styles.unreadDot} accessibilityLabel="Unread" />}
                </View>
                <Text style={[styles.title, !a.read && { fontWeight: "800" }]} numberOfLines={2}>{a.title}</Text>
                <Text style={styles.body} numberOfLines={2}>{a.body}</Text>
                <Text style={styles.dateLine}>{a.date}</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            error ? null : (
              <EmptyState
                icon={Megaphone}
                message={tab === "Unread" ? "You're all caught up — no unread announcements." : "No announcements yet. New posts from the Agriculture Office will show up here."}
              />
            )
          }
        />
      )}

      <Modal visible={!!open} animationType="slide" onRequestClose={() => setOpen(null)}>
        {open && (
          <View style={styles.detail}>
            <View style={styles.detailBar}>
              <CategoryBadge category={open.category} />
              <TouchableOpacity onPress={() => setOpen(null)} style={styles.closeBtn} accessibilityLabel="Close">
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
              <Text style={styles.detailDate}>Posted {open.date}</Text>
              {!!open.imagePath && (openImage ? (
                <Image source={{ uri: openImage }} style={styles.detailImage} resizeMode="cover" />
              ) : (
                <View style={[styles.detailImage, styles.imagePlaceholder]}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              ))}
              <Text style={styles.detailBody} selectable>{open.body}</Text>
            </ScrollView>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  tabsRow: { flexDirection: "row", paddingHorizontal: 16, gap: 6, marginBottom: 10 },
  tab: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.primaryLight },
  tabText: { fontSize: 11.5, color: colors.textMuted, fontWeight: "600" },
  tabTextActive: { color: colors.primaryDark },
  card: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 8,
  },
  annCard: { padding: 14 },
  cardUnread: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  cardUrgent: { borderLeftWidth: 4, borderLeftColor: colors.red },
  markAllBtn: { alignSelf: "flex-end", marginBottom: 8 },
  markAllText: { fontSize: 12, fontWeight: "700", color: colors.primaryDark },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: 10.5, fontWeight: "700" },
  pinned: { flexDirection: "row", alignItems: "center", gap: 3 },
  pinnedText: { fontSize: 10.5, fontWeight: "700", color: colors.primaryDark },
  date: { fontSize: 10, color: colors.textMuted, fontWeight: "600" },
  dateLine: { fontSize: 10.5, color: colors.textFaint, marginTop: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  title: { fontSize: 13.5, fontWeight: "700", color: colors.text, marginTop: 6 },
  body: { fontSize: 11.5, color: colors.textMuted, marginTop: 3, lineHeight: 16 },
  archiveBtn: { padding: 4, alignSelf: "flex-start" },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: 12.5, marginVertical: 20 },
  errorText: { textAlign: "center", color: colors.red, fontSize: 12, marginBottom: 10 },

  detail: { flex: 1, backgroundColor: colors.card },
  detailBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  detailContent: { padding: spacing.base, paddingBottom: 48 },
  detailTitle: { fontSize: 20, fontWeight: "800", color: colors.text, lineHeight: 26 },
  detailDate: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: 14 },
  detailImage: { width: "100%", height: 200, borderRadius: radius.md, marginBottom: 14 },
  imagePlaceholder: { backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  detailBody: { fontSize: 14.5, color: colors.text, lineHeight: 22 },
});
