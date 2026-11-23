import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Pin } from "lucide-react-native";
import { colors, radius } from "../theme";
import { getAnnouncementImageUrl } from "../lib/api/announcements";
import { formatPostedAt } from "../lib/dates";

const seal = require("../assets/da-seal.png");
const COLLAPSED_LINES = 5;
const BODY_FONT = 13.5;

// Lines the text needs at this width (when the platform can't measure it):
// each paragraph wraps at about one character per 0.53 × font size.
function estimateLines(text, width) {
  const perLine = Math.max(10, Math.floor(width / (BODY_FONT * 0.53)));
  return String(text ?? "").split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}

// One announcement as a simple post: the "MAO Labangan" seal and name, when
// it was posted, the text ("See more" after about 5 lines) and the photo
// full width. onOpen: tapping the post (marks it read).
export default function PostCard({ post, onOpen, unread = false, expanded: startExpanded = false, style }) {
  const { width } = useWindowDimensions();
  const [expanded, setExpanded] = useState(startExpanded);
  const [measured, setMeasured] = useState(null); // lines, where the platform reports them
  const textWidth = Math.min(width, 720) - 32 - 28;
  const lines = measured ?? estimateLines(post.body, textWidth);
  const canExpand = !expanded && lines > COLLAPSED_LINES;

  function open() {
    onOpen?.(post);
  }

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.card, unread && styles.cardUnread, pressed && { opacity: 0.92 }, style]}
      accessibilityRole="button"
      accessibilityLabel={`${post.isPinned ? "Pinned. " : ""}MAO Labangan, ${formatPostedAt(post.postedAt)}. ${post.firstLine}${unread ? ". Unread" : ""}`}
    >
      <View style={styles.head}>
        <Image source={seal} style={styles.avatar} accessibilityIgnoresInvertColors />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>MAO Labangan</Text>
          <Text style={styles.meta}>
            {formatPostedAt(post.postedAt)}
            {post.wasForwarded ? " · Forwarded by your Farmers' Association President" : ""}
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

      {!!post.body.trim() && (
        <View>
          {/* On a phone, an invisible copy measures the full text (the
              visible one is clipped); elsewhere the line count is estimated. */}
          {Platform.OS !== "web" && (
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
          <Text style={styles.body} numberOfLines={expanded ? undefined : COLLAPSED_LINES}>
            {post.body}
          </Text>
          {canExpand && (
            <Text
              style={styles.seeMore}
              onPress={() => {
                setExpanded(true);
                open();
              }}
              accessibilityRole="button"
            >
              See more
            </Text>
          )}
        </View>
      )}

      {!!post.imagePath && <PostPhoto path={post.imagePath} />}
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
    <Image source={{ uri: url }} style={[styles.photo, { aspectRatio: ratio }]} resizeMode="cover" accessibilityLabel="Photo" />
  ) : (
    <View style={[styles.photo, styles.photoLoading, { aspectRatio: ratio }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

// A small square of the post's photo (Home's Announcements card).
export function PostThumb({ path, size = 40 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    getAnnouncementImageUrl(path).then((u) => !cancelled && setUrl(u)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url ? (
    <Image source={{ uri: url }} style={[styles.thumb, { width: size, height: size }]} resizeMode="cover" accessibilityLabel="Photo" />
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
  body: { fontSize: BODY_FONT, color: colors.text, lineHeight: 20 },
  measure: { position: "absolute", left: 0, right: 0, opacity: 0 },
  seeMore: { fontSize: 13, fontWeight: "700", color: colors.textMuted, marginTop: 2 },
  photo: { width: "100%", borderRadius: radius.sm, marginTop: 10, backgroundColor: colors.header },
  photoLoading: { alignItems: "center", justifyContent: "center", backgroundColor: colors.header },
  thumb: { borderRadius: 8, backgroundColor: colors.header },
});
