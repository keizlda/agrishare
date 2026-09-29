import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Pill from "../components/Pill";
import Avatar from "../components/Avatar";
import Toast from "../components/ui/Toast";
import { colors, radius, shadows, sizes, spacing } from "../theme";
import { useAuth } from "../context/AuthContext";
import { removeAvatar, uploadAvatar } from "../lib/api/profile";

const AVATAR_SIZE = 68;

export default function ProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { farmer, updateAvatarUrl } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: "", tone: "success" });

  function showToast(message, tone = "success") {
    setToast({ visible: true, message, tone });
  }

  async function pickAndUpload(source) {
    setSheetOpen(false);
    try {
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

      const pickerOptions = { allowsEditing: true, aspect: [1, 1], quality: 1 };
      const result =
        source === "camera" ? await ImagePicker.launchCameraAsync(pickerOptions) : await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (result.canceled) return;

      setUploading(true);
      const manipulated = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 512, height: 512 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      const url = await uploadAvatar(farmer.profileId, manipulated.uri);
      updateAvatarUrl(url);
      showToast("Profile picture updated.");
    } catch (err) {
      showToast(err.message || "Couldn't update your profile picture.", "error");
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

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <Ionicons name="person-outline" size={16} color={colors.primaryDark} />
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarWrap}>
          <TouchableOpacity onPress={() => setSheetOpen(true)} disabled={uploading} style={styles.avatarTapArea}>
            <Avatar uri={farmer?.avatarUrl} size={AVATAR_SIZE} key={farmer?.avatarUrl} />
            {uploading && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
            <TouchableOpacity onPress={() => setSheetOpen(true)} disabled={uploading} style={styles.editBadge}>
              <Ionicons name="camera" size={13} color="#fff" />
            </TouchableOpacity>
          </TouchableOpacity>
          <Text style={styles.name}>{farmer?.firstName} {farmer?.lastName}</Text>
          <Text style={styles.subtitle}>Farmer · {farmer?.farmerId}</Text>
          <View>
            <Pill status={farmer?.validationStatus} />
          </View>
        </View>

        <Card title="Personal Information" icon="id-card-outline">
          <Row label="RSBSA Number" value={farmer?.rsbsaNo} />
          <Row label="Barangay" value={farmer?.barangay} />
          <Row label="Contact Number" value={farmer?.contactNo} />
        </Card>

        <Card title="Farming Information" icon="leaf-outline">
          <Row label="Farm Size" value={farmer?.farmSize} />
          <Row label="Primary Commodity" value={farmer?.primaryCommodity} last />
        </Card>

        <Text style={styles.note}>
          To update your profile information, please coordinate with your FA President or the Municipal Agriculture Office.
        </Text>
      </ScrollView>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setSheetOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.base }]} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            <SheetOption icon="camera-outline" label="Take Photo" onPress={() => pickAndUpload("camera")} />
            <SheetOption icon="image-outline" label="Choose from Gallery" onPress={() => pickAndUpload("gallery")} />
            {!!farmer?.avatarUrl && (
              <SheetOption icon="trash-outline" label="Remove Photo" danger onPress={handleRemove} />
            )}
            <SheetOption icon="close-outline" label="Cancel" onPress={() => setSheetOpen(false)} last />
          </View>
        </TouchableOpacity>
      </Modal>

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

function Card({ title, icon, children }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={14} color={colors.primaryDark} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ label, value, last }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: sizes.minTouchTarget / 2,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  headerTitle: { fontSize: 14.5, fontWeight: "700", color: colors.text },
  content: { padding: 16, paddingBottom: 32 },

  avatarWrap: { alignItems: "center", marginBottom: 20 },
  avatarTapArea: { marginBottom: 10 },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "rgba(20,40,25,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  editBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { fontSize: 16, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 11.5, color: colors.textMuted, marginBottom: 8 },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  cardTitle: { fontSize: 12.5, fontWeight: "700", color: colors.text },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { fontSize: 11.5, color: colors.textMuted },
  rowValue: { fontSize: 12.5, color: colors.text, fontWeight: "600" },

  note: { fontSize: 10.5, color: colors.textMuted, textAlign: "center", marginTop: 8, lineHeight: 15 },

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
