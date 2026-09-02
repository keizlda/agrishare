import { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../components/ScreenHeader";
import ReminderBanner from "../components/ReminderBanner";
import { colors, radius } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listAnnouncements, markAnnouncementRead, setAnnouncementArchived } from "../lib/api/announcements";

const TABS = ["All Announcements", "Unread", "Archived"];
const ICONS = ["megaphone-outline", "school-outline", "water-outline", "leaf-outline", "bug-outline", "leaf-outline"];

export default function AnnouncementsScreen() {
  const { farmer } = useAuth();
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState(TABS[0]);

  useEffect(() => {
    if (farmer?.profileId) listAnnouncements(farmer.profileId).then(setItems).catch(() => {});
  }, [farmer?.profileId]);

  const filtered = useMemo(() => {
    if (tab === "Archived") return items.filter((a) => a.archived);
    if (tab === "Unread") return items.filter((a) => !a.read && !a.archived);
    return items.filter((a) => !a.archived);
  }, [items, tab]);

  async function markAllRead() {
    const unread = items.filter((a) => !a.read && !a.archived);
    setItems((prev) => prev.map((a) => (a.archived ? a : { ...a, read: true, isNew: false })));
    await Promise.all(unread.map((a) => markAnnouncementRead(a.id, farmer.profileId))).catch(() => {});
  }

  async function toggleArchive(id) {
    const target = items.find((a) => a.id === id);
    if (!target) return;
    const nextArchived = !target.archived;
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, archived: nextArchived } : a)));
    await setAnnouncementArchived(id, farmer.profileId, nextArchived).catch(() => {});
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Announcements" />

      <View style={styles.tabsRow}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(a) => a.id}
        contentContainerStyle={styles.content}
        renderItem={({ item: a, index }) => (
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name={ICONS[index % ICONS.length]} size={16} color={colors.primaryDark} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.rowBetween}>
                <Text style={styles.date}>{a.isNew ? "New" : ""} {a.date} · {a.time}</Text>
                {!a.read && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.title}>{a.title}</Text>
              <Text style={styles.body} numberOfLines={2}>{a.body}</Text>
            </View>
            <TouchableOpacity onPress={() => toggleArchive(a.id)} style={styles.archiveBtn}>
              <Ionicons name={a.archived ? "arrow-undo-outline" : "archive-outline"} size={15} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={
          <>
            {filtered.length === 0 && (
              <Text style={styles.empty}>
                {tab === "Archived" ? "No archived announcements." : tab === "Unread" ? "You're all caught up." : "No announcements here yet."}
              </Text>
            )}
            {tab !== "Archived" && (
              <ReminderBanner text="Please regularly check for announcements to stay updated on important notices and schedules." actionLabel="Mark All as Read" onPress={markAllRead} />
            )}
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
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
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { fontSize: 10, color: colors.textMuted, fontWeight: "600" },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red },
  title: { fontSize: 12.5, fontWeight: "700", color: colors.text, marginTop: 3 },
  body: { fontSize: 11, color: colors.textMuted, marginTop: 3, lineHeight: 15 },
  archiveBtn: { padding: 4, alignSelf: "flex-start" },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: 12.5, marginVertical: 20 },
});
