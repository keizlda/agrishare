import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { CalendarDays, Clock, MapPin, Pin, Users } from "lucide-react-native";
import { colors, radius } from "../theme";
import { getAnnouncementImageUrl } from "../lib/api/announcements";
import { formatDate, formatPostedOn, formatTime } from "../lib/dates";

const seal = require("../assets/da-seal.png");
const COLLAPSED_LINES = 4;
const BODY_FONT = 13.5;
// Up to this many barangay names on a card; the rest as "+2 more".
const CARD_BARANGAYS = 3;

// Lines the text needs at this width (when the platform can't measure it):
// each paragraph wraps at about one character per 0.53 × font size.
function estimateLines(text, width) {
  const perLine = Math.max(10, Math.floor(width / (BODY_FONT * 0.53)));
  return String(text ?? "").split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}

// "Farmers · Langapud, Bagalupa" (or "· All barangays").
export function audienceText(post, limit = Infinity) {
  const names = post.barangayNames ?? [];
  const where = post.allBarangays ? "All barangays" : names.length > limit ? `${names.slice(0, limit).join(", ")} +${names.length - limit} more` : names.join(", ");
  return `${post.audienceLabel} · ${where}`;
}

// The highlighted date · time · venue row (only the parts that are filled).
function EventRow({ post }) {
  const parts = [
    post.date && { key: "date", Icon: CalendarDays, text: formatDate(post.date), label: "Date" },
    post.time && { key: "time", Icon: Clock, text: formatTime(post.time), label: "Time" },
    post.venue && { key: "venue", Icon: MapPin, text: post.venue, label: "Venue" },
  ].filter(Boolean);
  if (!parts.length) return null;
  return (
    <View style={styles.event}>
      {parts.map(({ key, Icon, text, label }) => (
        <View key={key} style={styles.eventPart} accessibilityLabel={`${label}: ${text}`}>
          <Icon size={13} color={colors.primaryDark} />
          <Text style={styles.eventText}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

// One announcement: the "MAO Labangan" seal and name, when it was posted,
// the bold title, the date / time / venue row, the details ("See more"
// after about 4 lines), the photo, and who can see it. Tapping anywhere
// opens it in full (onOpen). `full`: the details screen (everything shown).
export default function PostCard({ post, onOpen, unread = false, full = false, style }) {
  const { width } = useWindowDimensions();
  const [measured, setMeasured] = useState(null); // lines, where the platform reports them
  const textWidth = Math.min(width, 720) - 32 - 28;
  const lines = measured ?? estimateLines(post.body, textWidth);
  const canExpand = !full && lines > COLLAPSED_LINES;
  const posted = `Posted ${formatPostedOn(post.postedAt)}`;

  const content = (
    <>
      <View style={styles.head}>
        <Image source={seal} style={styles.avatar} accessibilityIgnoresInvertColors />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>MAO Labangan</Text>
          <Text style={styles.meta}>
            {posted}
            {post.wasForwarded ? " · Forwarded by a Farmers' Association President" : ""}
          </Text>
        </View>
        {post.isPinned && (
          <View style={styles.pinned}>
            <Pin size={11} color={colors.primaryDark} />
            <Text style={styles.pinnedText}>Pinned</Text>
          </View>
        )}
        {unread && <View style={styles.unreadDot} />}
      </View>

      <Text style={[styles.title, full && styles.titleFull]}>{post.title}</Text>
      <EventRow post={post} />

      {!!post.body.trim() && (
        <View>
          {/* On a phone, an invisible copy measures the full text (the
              visible one is clipped); elsewhere the line count is estimated. */}
          {Platform.OS !== "web" && !full && (
            <Text
              style={[styles.body, styles.measure]}
              onTextLayout={(e) => setMeasured(e.nativeEvent.lines.length)}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {post.body}
            </Text>
          )}
          <Text style={styles.body} numberOfLines={full ? undefined : COLLAPSED_LINES}>
            {post.body}
          </Text>
          {canExpand && (
            <Text style={styles.seeMore} onPress={() => onOpen?.(post)} accessibilityRole="button">
              See more
            </Text>
          )}
        </View>
      )}

      {!!post.imagePath && <PostPhoto path={post.imagePath} />}

      <View style={styles.foot}>
        <Users size={12} color={colors.textMuted} />
        <Text style={styles.footText}>{audienceText(post, full ? Infinity : CARD_BARANGAYS)}</Text>
      </View>
    </>
  );

  if (full) return <View style={[styles.card, style]}>{content}</View>;
  return (
    <Pressable
      onPress={() => onOpen?.(post)}
      style={({ pressed }) => [styles.card, unread && styles.cardUnread, pressed && { opacity: 0.92 }, style]}
      accessibilityRole="button"
      accessibilityLabel={`${post.isPinned ? "Pinned. " : ""}${post.title}. ${posted}${unread ? ". Unread" : ""}`}
    >
      {content}
    </Pressable>
  );
}

// The post's photo, full width at its own shape (very tall or wide photos
// are cropped to a sensible range).
function PostPhoto({ path }) {
  const [url, setUrl] = useState(null);
  const [ratio, setRatio] = useState(4 / 3);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAnnouncementImageUrl(path)
      .then((u) => {
        if (cancelled) return;
        setUrl(u);
        Image.getSize(u, (w, h) => !cancelled && w > 0 && h > 0 && setRatio(Math.min(2, Math.max(0.75, w / h))), () => {});
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) return null;
  return url ? (
    <Image source={{ uri: url }} style={[styles.photo, { aspectRatio: ratio }]} resizeMode="cover" accessibilityLabel="Photo" onError={() => setFailed(true)} />
  ) : (
    <View style={[styles.photo, styles.photoLoading, { aspectRatio: ratio }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

// A small square of the post's photo (Home's Announcements card).
export function PostThumb({ path, size = 40 }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getAnnouncementImageUrl(path).then((u) => !cancelled && setUrl(u)).catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (failed) return null;
  return url ? (
    <Image source={{ uri: url }} style={[styles.thumb, { width: size, height: size }]} resizeMode="cover" accessibilityLabel="Photo" onError={() => setFailed(true)} />
  ) : (
    <View style={[styles.thumb, styles.photoLoading, { width: size, height: size }]} />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 10,
  },
  cardUnread: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.header },
  name: { fontSize: 13.5, fontWeight: "800", color: colors.text },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  pinned: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start" },
  pinnedText: { fontSize: 10.5, fontWeight: "700", color: colors.primaryDark },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, alignSelf: "flex-start", marginTop: 4 },
  title: { fontSize: 15, fontWeight: "800", color: colors.text, lineHeight: 20, marginBottom: 8 },
  titleFull: { fontSize: 17, lineHeight: 23 },
  event: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    marginBottom: 8,
  },
  eventPart: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%" },
  eventText: { fontSize: 12.5, fontWeight: "700", color: colors.primaryDark, flexShrink: 1 },
  body: { fontSize: BODY_FONT, color: colors.text, lineHeight: 20 },
  measure: { position: "absolute", left: 0, right: 0, opacity: 0 },
  seeMore: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: 2 },
  photo: { width: "100%", borderRadius: radius.sm, marginTop: 10, backgroundColor: colors.header },
  photoLoading: { alignItems: "center", justifyContent: "center", backgroundColor: colors.header },
  thumb: { borderRadius: 8, backgroundColor: colors.header },
  foot: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 10 },
  footText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 15 },
});
