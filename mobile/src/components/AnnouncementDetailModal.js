import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { X } from "lucide-react-native";
import PostCard from "./PostCard";
import { colors, spacing } from "../theme";

// One announcement opened from the Announcements card on Home: the post in
// full (text and photo), the same as on the Announcements screen.
export default function AnnouncementDetailModal({ announcement: open, onClose }) {
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
            <PostCard post={open} expanded />
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  detail: { flex: 1, backgroundColor: colors.bg },
  detailBar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 16, paddingTop: 54, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.header },
  closeBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" },
  detailContent: { padding: spacing.base, paddingBottom: 48 },
});
