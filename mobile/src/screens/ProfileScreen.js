import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ScreenHeader from "../components/ScreenHeader";
import Pill from "../components/Pill";
import Avatar from "../components/Avatar";
import AvatarCropModal from "../components/AvatarCropModal";
import Toast from "../components/ui/Toast";
import { colors, radius, shadows, spacing } from "../theme";
import { useAuth } from "../context/AuthContext";
import { removeAvatar, uploadAvatar } from "../lib/api/profile";
import { useTabBarHeight } from "../hooks/useTabBarHeight";

const AVATAR_SIZE = 96;
const BANNER_HEIGHT = 70;

const ACCOUNT_ITEMS = [{ icon: "key-outline", label: "Change Password" }];

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useTabBarHeight();
  const { farmer, logout, updateAvatarUrl, refreshFarmer } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cropUri, setCropUri] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: "", tone: "success" });

  function showToast(message, tone = "success") {
    setToast({ visible: true, message, tone });
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refreshFarmer();
    } catch {
      // Keep whatever was already on screen — a failed pull-to-refresh
      // shouldn't blank out a profile that loaded fine a moment ago.
    } finally {
      setRefreshing(false);
    }
  }

  async function pickPhoto(source) {
    setSheetOpen(false);
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        source === "camera" ? "Camera permission needed" : "Photo library permission needed",
        `AgriShare needs access to your ${source === "camera" ? "camera" : "photos"} to set a profile picture.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }

    // allowsEditing is off here on purpose — the native cropper is replaced
    // by AvatarCropModal's circular drag/pinch UI below.
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync({ quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (result.canceled) return;
    setCropUri(result.assets[0].uri);
  }

  async function handleCropConfirm(finalUri, err) {
    setCropUri(null);
    if (!finalUri) {
      if (err) showToast(err.message || "Couldn't process that photo.", "error");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadAvatar(farmer.profileId, finalUri);
      updateAvatarUrl(url);
      showToast("Profile picture updated.");
    } catch (uploadErr) {
      showToast(uploadErr.message || "Couldn't update your profile picture.", "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setSheetOpen(false);
    setUploading(true);
    try {
      await removeAvatar(farmer.profileId);
      updateAvatarUrl(null);
      showToast("Profile picture removed.");
    } catch (err) {
      showToast(err.message || "Couldn't remove your profile picture.", "error");
    } finally {
      setUploading(false);
    }
  }

  const HANDLERS = {
    "Change Password": () => navigation.navigate("ChangePassword"),
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Profile" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <View style={styles.headerCard}>
          <View style={styles.banner} />

          <TouchableOpacity onPress={() => setSheetOpen(true)} disabled={uploading} style={styles.avatarTapArea}>
            <View style={styles.avatarRing}>
              <Avatar uri={farmer?.avatarUrl} size={AVATAR_SIZE} key={farmer?.avatarUrl} />
            </View>
            {uploading && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
            <TouchableOpacity onPress={() => setSheetOpen(true)} disabled={uploading} style={styles.editBadge}>
              <Ionicons name="camera" size={15} color="#fff" />
            </TouchableOpacity>
          </TouchableOpacity>

          <Text style={styles.name}>{farmer?.firstName} {farmer?.lastName}</Text>
          <Text style={styles.subtitle}>Farmer · {farmer?.barangay}</Text>
          <View>
            <Pill status={farmer?.validationStatus} />
          </View>
        </View>

        <Section title="Personal Information">
          <Row label="RSBSA Number" value={farmer?.rsbsaNo} />
          <Row label="Barangay" value={farmer?.barangay} />
          <Row label="Contact Number" value={farmer?.contactNo} />
        </Section>

        <Section title="Farming Information">
          <Row label="Farm Size" value={farmer?.farmSize} />
          <Row label="Primary Commodity" value={farmer?.primaryCommodity} last />
        </Section>

        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
          <Text style={styles.noteText}>
            To update your information, coordinate with your FA President or the Municipal Agriculture Office.
          </Text>
        </View>

        <Section title="Account">
          {ACCOUNT_ITEMS.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[styles.itemRow, i === ACCOUNT_ITEMS.length - 1 && { borderBottomWidth: 0 }]}
              onPress={HANDLERS[item.label]}
            >
              <Ionicons name={item.icon} size={16} color={colors.textMuted} style={{ width: 22 }} />
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={14} color="#c3ccc5" />
            </TouchableOpacity>
          ))}
        </Section>

        <TouchableOpacity style={styles.logoutRow} onPress={logout}>
          <Ionicons name="log-out-outline" size={16} color={colors.red} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
        <Text style={styles.version}>App Version 1.0.0</Text>
      </ScrollView>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setSheetOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.base }]} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <SheetOption icon="camera-outline" label="Take Photo" onPress={() => pickPhoto("camera")} />
            <SheetOption icon="image-outline" label="Choose from Gallery" onPress={() => pickPhoto("gallery")} />
            {!!farmer?.avatarUrl && <SheetOption icon="trash-outline" label="Remove Photo" danger onPress={handleRemove} />}
            <SheetOption icon="close-outline" label="Cancel" onPress={() => setSheetOpen(false)} last />
          </View>
        </TouchableOpacity>
      </Modal>

      <AvatarCropModal visible={!!cropUri} uri={cropUri} onCancel={() => setCropUri(null)} onConfirm={handleCropConfirm} />

      <Toast visible={toast.visible} message={toast.message} tone={toast.tone} onDone={() => setToast((t) => ({ ...t, visible: false }))} />
    </View>
  );
}

function SheetOption({ icon, label, onPress, danger, last }) {
  return (
    <TouchableOpacity style={[styles.sheetOption, last && { borderBottomWidth: 0 }]} onPress={onPress}>
      <Ionicons name={icon} size={19} color={danger ? colors.red : colors.text} />
      <Text style={[styles.sheetOptionText, danger && { color: colors.red }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value, last }) {
  return (
    <View style={[styles.itemRow, styles.dataRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },

  headerCard: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
    paddingBottom: 18,
    marginBottom: 16,
    ...shadows.card,
  },
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: BANNER_HEIGHT,
    backgroundColor: colors.primaryLight,
  },
  avatarTapArea: { marginTop: BANNER_HEIGHT - AVATAR_SIZE / 2, marginBottom: 10 },
  avatarRing: {
    borderRadius: AVATAR_SIZE / 2 + 4,
    borderWidth: 4,
    borderColor: "#fff",
    shadowColor: "#14281a",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: AVATAR_SIZE / 2 + 4,
    backgroundColor: "rgba(20,40,25,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  editBadge: {
    position: "absolute",
    right: -2,
    bottom: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 17, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: 8 },

  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.textMuted, marginBottom: 6, textTransform: "uppercase" },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    ...shadows.card,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemLabel: { flex: 1, fontSize: 12.5, color: colors.text },
  dataRow: { justifyContent: "space-between" },
  rowLabel: { fontSize: 11.5, color: colors.textMuted },
  rowValue: { fontSize: 12.5, color: colors.text, fontWeight: "600" },

  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: colors.grayBg,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  noteText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 16 },

  logoutRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
  logoutText: { color: colors.red, fontWeight: "700", fontSize: 13 },
  version: { textAlign: "center", fontSize: 10.5, color: "#a8b3ab" },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(20,40,25,0.35)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.base,
    ...shadows.sheet,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.sm,
  },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetOptionText: { fontSize: 14, fontWeight: "600", color: colors.text },
});
