import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Pill from "../components/Pill";
import { colors, radius } from "../theme";
import { cropValidationSample } from "../data/mockData";
import { useAuth } from "../context/AuthContext";
import { submitCropValidation, uploadPlaceholderCropPhoto } from "../lib/api/cropValidation";

const CROP_TYPES = ["Rice", "Corn", "Vegetables", "Other"];

// Camera capture and GPS tagging are mocked here (a real build wires these to
// expo-image-picker + expo-location, which need native permission prompts
// that don't make sense to simulate in a UI-first pass) — tapping the photo
// box uploads a placeholder image to the real Storage bucket instead of an
// actual camera capture. Submitting creates a real crop_validations row.
export default function CropValidationScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { farmer } = useAuth();
  const s = cropValidationSample;
  const [cropType, setCropType] = useState("Rice");
  const [areaPlanted, setAreaPlanted] = useState("0.50");
  const [plantingDate, setPlantingDate] = useState(s.distributionDate);
  const [remarks, setRemarks] = useState("");
  const [photoCaptured, setPhotoCaptured] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPath, setPhotoPath] = useState(null);
  const [gpsCaptured, setGpsCaptured] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const checklist = [
    { label: "GPS successfully captured", done: gpsCaptured },
    { label: "Crop photo uploaded", done: photoCaptured },
    { label: "Commodity has been planted", done: true },
    { label: "Information verified by farmer", done: true },
  ];
  const allDone = checklist.every((c) => c.done);

  async function handleCapturePhoto() {
    setUploadingPhoto(true);
    try {
      const path = await uploadPlaceholderCropPhoto(farmer.farmerId);
      setPhotoPath(path);
      setPhotoCaptured(true);
    } catch (err) {
      Alert.alert("Photo upload failed", err.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmit() {
    if (!allDone) {
      Alert.alert("Incomplete", "Please capture a crop photo before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await submitCropValidation({
        farmerId: farmer.farmerId,
        photoPath,
        latitude: 7.245123,
        longitude: 123.654321,
        gpsAccuracyMeters: 5.2,
        remarks: remarks || `${cropType} · ${areaPlanted} ha · planted ${plantingDate}`,
      });
      Alert.alert("Submitted", "Your crop validation has been submitted for MAO/FA President review.");
      navigation.goBack();
    } catch (err) {
      Alert.alert("Submission failed", err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <Ionicons name="leaf-outline" size={16} color={colors.primaryDark} />
        <Text style={styles.headerTitle}>Crop Validation</Text>
        <View style={{ flex: 1 }} />
        <Pill status="Pending" label="PENDING VALIDATION" />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card title="Farmer Information" icon="person-outline">
          <InfoRow label="Farmer Name" value={s.farmerName} />
          <InfoRow label="RSBSA Number" value={s.rsbsaNo} />
          <InfoRow label="Barangay" value={s.barangay} />
          <InfoRow label="Commodity Received" value={s.commodityReceived} />
          <InfoRow label="Distribution Date" value={s.distributionDate} last />
        </Card>

        <View style={styles.twoCol}>
          <Card title="Current Location" icon="location-outline" style={{ flex: 1 }}>
            <View style={styles.mapPlaceholder}>
              <Ionicons name="location" size={22} color={colors.primary} />
            </View>
          </Card>
          <Card title="GPS Geotag" icon="navigate-outline" style={{ flex: 1 }}>
            <InfoRow label="Latitude" value={s.gps.latitude} small />
            <InfoRow label="Longitude" value={s.gps.longitude} small />
            <InfoRow label="Captured" value={s.gps.capturedAt} small />
            <InfoRow label="Accuracy" value={`${s.gps.accuracy} · ${s.gps.accuracyRating}`} small last />
          </Card>
        </View>

        <Card title="Crop Photo (Proof of Planting)" icon="camera-outline">
          <TouchableOpacity
            style={[styles.photoBox, photoCaptured && styles.photoBoxFilled]}
            onPress={handleCapturePhoto}
            disabled={uploadingPhoto || photoCaptured}
          >
            {photoCaptured ? (
              <>
                <Ionicons name="checkmark-circle" size={26} color={colors.primary} />
                <Text style={styles.photoCaptionFilled}>Photo captured</Text>
                <Text style={styles.photoMeta}>{s.barangay}, Labangan · {s.gps.latitude} {s.gps.longitude}</Text>
              </>
            ) : (
              <>
                <Ionicons name="camera" size={26} color={colors.textMuted} />
                <Text style={styles.photoCaption}>{uploadingPhoto ? "Uploading…" : "Tap to take a geotagged photo"}</Text>
              </>
            )}
          </TouchableOpacity>
        </Card>

        <Card title="Validation Details" icon="document-text-outline">
          <Text style={styles.fieldLabel}>Crop Type</Text>
          <View style={styles.chipRow}>
            {CROP_TYPES.map((c) => (
              <TouchableOpacity key={c} onPress={() => setCropType(c)} style={[styles.chip, cropType === c && styles.chipActive]}>
                <Text style={[styles.chipText, cropType === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Area Planted (hectares)</Text>
          <TextInput style={styles.input} value={areaPlanted} onChangeText={setAreaPlanted} keyboardType="decimal-pad" />

          <Text style={styles.fieldLabel}>Planting Date</Text>
          <TextInput style={styles.input} value={plantingDate} onChangeText={setPlantingDate} placeholder="YYYY-MM-DD" />

          <Text style={styles.fieldLabel}>Remarks (Optional)</Text>
          <TextInput
            style={[styles.input, { height: 64, textAlignVertical: "top" }]}
            value={remarks}
            onChangeText={setRemarks}
            multiline
            placeholder="Add any notes for the reviewer"
            placeholderTextColor="#9aa89f"
          />
        </Card>

        <Card title="Validation Checklist" icon="checkbox-outline">
          {checklist.map((c) => (
            <View key={c.label} style={styles.checkRow}>
              <Ionicons
                name={c.done ? "checkmark-circle" : "ellipse-outline"}
                size={16}
                color={c.done ? colors.primary : colors.textMuted}
              />
              <Text style={styles.checkLabel}>{c.label}</Text>
            </View>
          ))}
        </Card>

        <TouchableOpacity style={[styles.submitBtn, (!allDone || submitting) && { opacity: 0.5 }]} onPress={handleSubmit} disabled={submitting}>
          <Ionicons name="send" size={15} color="#fff" />
          <Text style={styles.submitText}>{submitting ? "Submitting…" : "Submit Validation"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Card({ title, icon, children, style }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={14} color={colors.primaryDark} />
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function InfoRow({ label, value, small, last }) {
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Text style={[styles.infoLabel, small && { fontSize: 9.5 }]}>{label}</Text>
      <Text style={[styles.infoValue, small && { fontSize: 11 }]}>{value}</Text>
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
    paddingVertical: 10,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 14.5, fontWeight: "700", color: colors.text },
  content: { padding: 16, paddingBottom: 32 },
  twoCol: { flexDirection: "row", gap: 10 },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  cardTitle: { fontSize: 12, fontWeight: "700", color: colors.text },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: { fontSize: 10.5, color: colors.textMuted },
  infoValue: { fontSize: 11.5, color: colors.text, fontWeight: "600" },

  mapPlaceholder: {
    height: 90,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },

  photoBox: {
    height: 120,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  photoBoxFilled: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderStyle: "solid" },
  photoCaption: { fontSize: 11.5, color: colors.textMuted },
  photoCaptionFilled: { fontSize: 11.5, color: colors.primaryDark, fontWeight: "700" },
  photoMeta: { fontSize: 9.5, color: colors.primaryDark },

  fieldLabel: { fontSize: 10.5, fontWeight: "700", color: colors.textMuted, marginTop: 8, marginBottom: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 11, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12.5,
    color: colors.text,
  },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  checkLabel: { fontSize: 12, color: colors.text },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: 13,
    marginTop: 4,
  },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
});
