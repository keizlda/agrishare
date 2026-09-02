import { useRef, useState } from "react";
import { Alert, Image, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";
import { captureRef } from "react-native-view-shot";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Pill from "../components/Pill";
import { colors, radius } from "../theme";
import { cropValidationSample } from "../data/mockData";
import { useAuth } from "../context/AuthContext";
import { submitCropValidation, uploadCropPhoto } from "../lib/api/cropValidation";

const CROP_TYPES = ["Rice", "Corn", "Vegetables", "Other"];

function accuracyRating(meters) {
  if (meters == null) return "Unknown";
  if (meters <= 10) return "High";
  if (meters <= 30) return "Medium";
  return "Low";
}

// Barangay Langapud's approximate center — the schema has no per-parcel GPS
// coordinates, so this is the only geographic anchor available to flag a
// submission that's obviously nowhere near the declared parcel. Mirrors the
// same reference point and threshold the MAO/FA review screen on web uses,
// so both sides agree on what counts as "far."
const LANGAPUD_REF = { lat: 7.8333, lng: 123.6333 };
const FAR_THRESHOLD_KM = 5;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Degrees-minutes-seconds — the traditional cadastral survey convention,
// alongside the decimal form GPS actually returns.
function toDMS(value, isLat) {
  const dir = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W";
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = ((minFloat - min) * 60).toFixed(1);
  return `${deg}°${min}'${sec}"${dir}`;
}

// The keyless output=embed URL only renders when it's actually loaded inside
// an <iframe> — Google's page checks window.top !== window.self and refuses
// otherwise. A WebView's top-level document IS window.top, so loading the
// URL directly trips that check. Wrapping it in a one-line local HTML page
// that itself puts the map in a real iframe satisfies the check.
function mapEmbedHtml(latitude, longitude) {
  const src = `https://www.google.com/maps?q=${latitude},${longitude}&z=15&output=embed`;
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>html,body{margin:0;padding:0;height:100%;}iframe{border:0;width:100%;height:100%;}</style></head>
    <body><iframe src="${src}"></iframe></body></html>`;
}

// Both the photo and GPS geotag are real: the photo comes from the device
// camera via expo-image-picker, and the location from expo-location, each
// gated behind a real native permission prompt before the record is built.
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
  const [stamping, setStamping] = useState(false);
  const [photoPath, setPhotoPath] = useState(null);
  const [photoUri, setPhotoUri] = useState(null);
  const [stampJob, setStampJob] = useState(null);
  const [location, setLocation] = useState(null);
  const [locatingGps, setLocatingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const stampRef = useRef(null);

  const checklist = [
    { label: "GPS successfully captured", done: !!location },
    { label: "Geotagged photo uploaded", done: photoCaptured },
    { label: "Commodity has been planted", done: true },
    { label: "Information verified by farmer", done: true },
  ];
  const allDone = checklist.every((c) => c.done);

  async function handleCaptureLocation() {
    setLocatingGps(true);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        Alert.alert("Location services off", "Please enable location services on your device and try again.");
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Location permission needed",
          "AgriShare needs access to your location to geotag this crop validation.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = position.coords;

      let placeLabel = null;
      try {
        const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (address) {
          const locality = address.city || address.district || address.subregion;
          const region = address.region || address.country;
          placeLabel = [locality, region].filter(Boolean).join(", ") || null;
        }
      } catch {
        // Reverse geocoding is a label nicety, not required for a valid geotag.
      }

      setLocation({
        latitude,
        longitude,
        accuracy: position.coords.accuracy,
        placeLabel,
        distanceKm: haversineKm(latitude, longitude, LANGAPUD_REF.lat, LANGAPUD_REF.lng),
        capturedAt: new Date(position.timestamp).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
      });
    } catch (err) {
      Alert.alert("Couldn't get your location", err.message);
    } finally {
      setLocatingGps(false);
    }
  }

  function handleOpenMap() {
    if (!location) return;
    const query = `${location.latitude},${location.longitude}`;
    const url = Platform.select({
      ios: `maps:0,0?q=Crop Validation Location@${query}`,
      android: `geo:0,0?q=${query}(Crop Validation Location)`,
      default: `https://www.google.com/maps/search/?api=1&query=${query}`,
    });
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`));
  }

  async function handleCapturePhoto() {
    if (!location) {
      Alert.alert("Capture your location first", "Please capture your GPS location before taking a photo, so it can be geotagged and stamped.");
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Camera permission needed",
          "AgriShare needs access to your camera to take a proof-of-planting photo.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (result.canceled) return;

      const asset = result.assets[0];
      const aspect = asset.width && asset.height ? asset.height / asset.width : 4 / 3;
      const displayWidth = 500;
      setStamping(true);
      setStampJob({ uri: asset.uri, displayWidth, displayHeight: Math.round(displayWidth * aspect) });
    } catch (err) {
      Alert.alert("Photo capture failed", err.message);
    }
  }

  // Runs once the off-screen composite (raw photo + data stamp overlay) has
  // fully rendered — signaled by the Image's onLoadEnd, since the Text nodes
  // around it lay out synchronously but the bitmap decode doesn't. Flattens
  // that composite into a single JPEG and uploads *that*, so the geotag
  // travels with the image itself instead of living only in form fields.
  async function handleStampReady() {
    try {
      const uri = await captureRef(stampRef, { format: "jpg", quality: 0.85, result: "tmpfile" });
      setStampJob(null);
      setStamping(false);
      setPhotoUri(uri);
      setUploadingPhoto(true);
      const path = await uploadCropPhoto(farmer.farmerId, uri);
      setPhotoPath(path);
      setPhotoCaptured(true);
    } catch (err) {
      setStampJob(null);
      setStamping(false);
      Alert.alert("Photo stamping failed", err.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  function handleSubmit() {
    if (!location) {
      Alert.alert("Incomplete", "Please capture your GPS location before submitting.");
      return;
    }
    if (!allDone) {
      Alert.alert("Incomplete", "Please capture a crop photo before submitting.");
      return;
    }
    if (location.distanceKm > FAR_THRESHOLD_KM) {
      Alert.alert(
        "Far from Barangay Langapud",
        `Your captured location is about ${location.distanceKm.toFixed(1)} km from Barangay Langapud. Make sure you're at your registered farm before submitting.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Submit Anyway", style: "destructive", onPress: performSubmit },
        ]
      );
      return;
    }
    performSubmit();
  }

  async function performSubmit() {
    setSubmitting(true);
    try {
      await submitCropValidation({
        farmerId: farmer.farmerId,
        photoPath,
        latitude: location.latitude,
        longitude: location.longitude,
        gpsAccuracyMeters: location.accuracy,
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

        <Card
          title="Current Location"
          icon="location-outline"
          action={
            location && (
              <TouchableOpacity style={styles.recaptureBtn} onPress={handleCaptureLocation} disabled={locatingGps}>
                <Ionicons name="refresh" size={12} color={colors.primaryDark} />
                <Text style={styles.recaptureText}>{locatingGps ? "Locating…" : "Recapture"}</Text>
              </TouchableOpacity>
            )
          }
        >
          {location ? (
            <>
              <View style={styles.mapFrameWrap}>
                <WebView source={{ html: mapEmbedHtml(location.latitude, location.longitude) }} style={styles.mapFrame} />
              </View>
              <TouchableOpacity style={styles.mapOpenLink} onPress={handleOpenMap}>
                <Ionicons name="open-outline" size={12} color={colors.primaryDark} />
                <Text style={styles.mapOpenLinkText}>Open in Maps app</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.mapPlaceholder} onPress={handleCaptureLocation} disabled={locatingGps}>
              <Ionicons name="location" size={22} color={colors.primary} />
              <Text style={styles.mapPlaceholderText}>{locatingGps ? "Locating…" : "Tap to capture"}</Text>
            </TouchableOpacity>
          )}
        </Card>

        <Card title="GPS Geotag" icon="navigate-outline">
          <InfoRow label="Latitude" value={location ? location.latitude.toFixed(6) : "—"} small />
          <InfoRow label="Longitude" value={location ? location.longitude.toFixed(6) : "—"} small />
          <InfoRow label="Place" value={location ? location.placeLabel || "Unknown" : "—"} small />
          <InfoRow label="Captured" value={location ? location.capturedAt : "—"} small />
          <InfoRow
            label="Accuracy"
            value={location ? `±${Math.round(location.accuracy)} m · ${accuracyRating(location.accuracy)}` : "—"}
            small
          />
          <InfoRow
            label="From Barangay"
            value={location ? `${location.distanceKm.toFixed(1)} km` : "—"}
            small
            last
            warn={location && location.distanceKm > FAR_THRESHOLD_KM}
          />
        </Card>

        {location && location.distanceKm > FAR_THRESHOLD_KM && (
          <View style={styles.warningBanner}>
            <Ionicons name="warning" size={16} color={colors.orange} />
            <Text style={styles.warningText}>
              You're ~{location.distanceKm.toFixed(1)} km from Barangay Langapud. Make sure you're at your registered
              farm before submitting — exact parcel coordinates aren't on file, so this compares against the
              barangay's approximate center.
            </Text>
          </View>
        )}

        <Card title="Crop Photo (Proof of Planting)" icon="camera-outline">
          <TouchableOpacity
            style={[styles.photoBox, !!photoUri && styles.photoBoxFilled]}
            onPress={handleCapturePhoto}
            disabled={uploadingPhoto || photoCaptured || stamping}
          >
            {photoUri ? (
              <>
                <Image source={{ uri: photoUri }} style={styles.photoPreview} resizeMode="cover" />
                <View style={styles.photoOverlay}>
                  <View style={styles.photoOverlayRow}>
                    <Ionicons
                      name={uploadingPhoto ? "cloud-upload-outline" : "checkmark-circle"}
                      size={14}
                      color="#fff"
                    />
                    <Text style={styles.photoOverlayTitle}>{uploadingPhoto ? "Uploading…" : "Geotagged photo captured"}</Text>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Ionicons name="camera" size={26} color={colors.textMuted} />
                <Text style={styles.photoCaption}>
                  {stamping ? "Stamping geotag onto photo…" : location ? "Tap to take a geotagged photo" : "Capture your GPS location first"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </Card>

        {/* Off-screen: composites the raw photo + a burned-in geotag stamp
            box, then captureRef flattens it into the JPEG that actually gets
            uploaded. Never visible — positioned far outside the viewport. */}
        {stampJob && location && (
          <View style={styles.offscreenHost} pointerEvents="none">
            <View ref={stampRef} collapsable={false} style={{ width: stampJob.displayWidth, height: stampJob.displayHeight }}>
              <Image
                source={{ uri: stampJob.uri }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
                onLoadEnd={handleStampReady}
              />
              <View style={styles.stampBox}>
                <View style={styles.stampHeaderRow}>
                  <Ionicons name="location" size={13} color="#fff" />
                  <Text style={styles.stampHeaderText}>AGRISHARE CROP VALIDATION</Text>
                </View>
                <Text style={styles.stampPlace}>{location.placeLabel || "Unknown location"}</Text>
                <Text style={styles.stampLine}>
                  {location.latitude.toFixed(6)}°, {location.longitude.toFixed(6)}°
                </Text>
                <Text style={styles.stampLine}>
                  {toDMS(location.latitude, true)} {toDMS(location.longitude, false)}
                </Text>
                <Text style={styles.stampMeta}>
                  {location.capturedAt} · ±{Math.round(location.accuracy)} m accuracy · {location.distanceKm.toFixed(1)} km from Brgy.
                  Langapud
                </Text>
                <Text style={styles.stampRef}>
                  RSBSA {farmer?.rsbsaNo ?? "—"} · {farmer?.firstName} {farmer?.lastName}
                </Text>
              </View>
            </View>
          </View>
        )}

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

function Card({ title, icon, children, style, action }) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <Ionicons name={icon} size={14} color={colors.primaryDark} />
        <Text style={styles.cardTitle}>{title}</Text>
        {action && <View style={styles.cardHeaderAction}>{action}</View>}
      </View>
      {children}
    </View>
  );
}

function InfoRow({ label, value, small, last, warn }) {
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Text style={[styles.infoLabel, small && { fontSize: 9.5 }]}>{label}</Text>
      <Text style={[styles.infoValue, small && { fontSize: 11 }, warn && { color: colors.orange }]}>{value}</Text>
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

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },

  warningBanner: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.orangeBg,
    borderWidth: 1,
    borderColor: colors.orange,
    borderRadius: radius.md,
    padding: 10,
    marginBottom: 12,
  },
  warningText: { flex: 1, fontSize: 11, color: colors.text, lineHeight: 15.5 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  cardTitle: { fontSize: 12, fontWeight: "700", color: colors.text },
  cardHeaderAction: { marginLeft: "auto" },

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
    height: 110,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  mapPlaceholderText: { fontSize: 11, color: colors.primaryDark, fontWeight: "600", textAlign: "center", paddingHorizontal: 6 },

  mapFrameWrap: {
    height: 200,
    borderRadius: radius.sm,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  mapFrame: { flex: 1 },
  mapOpenLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8, alignSelf: "flex-start" },
  mapOpenLinkText: { fontSize: 11, color: colors.primaryDark, fontWeight: "600" },

  recaptureBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  recaptureText: { fontSize: 10.5, color: colors.primaryDark, fontWeight: "600" },

  photoBox: {
    height: 180,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
    position: "relative",
  },
  photoBoxFilled: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderStyle: "solid" },
  photoCaption: { fontSize: 11.5, color: colors.textMuted },
  photoPreview: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  photoOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,35,20,0.6)",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  photoOverlayRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  photoOverlayTitle: { color: "#fff", fontWeight: "700", fontSize: 12 },

  offscreenHost: { position: "absolute", top: 0, left: -10000 },
  stampBox: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,25,15,0.72)",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  stampHeaderRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 5 },
  stampHeaderText: { color: "#fff", fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  stampPlace: { color: "#fff", fontSize: 13.5, fontWeight: "800", marginBottom: 3 },
  stampLine: { color: "rgba(255,255,255,0.92)", fontSize: 10.5, marginBottom: 1 },
  stampMeta: { color: "rgba(255,255,255,0.8)", fontSize: 9, marginTop: 4 },
  stampRef: { color: "rgba(255,255,255,0.7)", fontSize: 8.5, marginTop: 2 },

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
