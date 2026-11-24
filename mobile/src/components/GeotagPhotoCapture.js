import { useRef, useState } from "react";
import { Alert, Image, Linking, Modal, PixelRatio, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { WebView } from "react-native-webview";
import { captureRef } from "react-native-view-shot";
import { colors, radius, sizes } from "../theme";
import { formatDateTime } from "../lib/dates";
import { friendlyError } from "../lib/friendlyError";
import { FAR_THRESHOLD_KM, accuracyRating, distanceFromCenter, mapEmbedHtml, withTimeout } from "../lib/geotag";
import { useAuth } from "../context/AuthContext";

// GPS location + a camera photo stamped with that location, the same capture
// as proof of planting: capture the location first, then take the photo;
// the stamp (place, coordinates, accuracy, time, RSBSA) is drawn onto the
// photo itself before it's uploaded with `upload(uri) -> storage path`.
// Calls onChange({ path, uri, latitude, longitude, accuracy, distanceKm })
// once the stamped photo is saved, or onChange(null) when it's retaken.
// onLocation({ latitude, longitude, accuracy }) fires as soon as the GPS
// location is captured, so it can be saved even without a photo.
export default function GeotagPhotoCapture({ stampTitle, rsbsaNo, upload, onChange, onLocation, purpose = "this report", disabled }) {
  const { farmer } = useAuth();
  const [location, setLocation] = useState(null);
  const [locating, setLocating] = useState(false);
  const [stampJob, setStampJob] = useState(null);
  const [photoUri, setPhotoUri] = useState(null);
  const [saved, setSaved] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [boxSize, setBoxSize] = useState(null);
  const stampRef = useRef(null);

  async function captureLocation() {
    setLocating(true);
    try {
      if (!(await Location.hasServicesEnabledAsync())) {
        Alert.alert("Location services off", "Please turn on location on your phone and try again.");
        return;
      }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location permission needed", `AgriShare needs your location to geotag ${purpose}.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = position.coords;
      let placeLabel = null;
      try {
        const [address] = await withTimeout(Location.reverseGeocodeAsync({ latitude, longitude }), 8000);
        if (address) placeLabel = [address.city || address.district || address.subregion, address.region || address.country].filter(Boolean).join(", ") || null;
      } catch {
        // The place name is a nicety, not required for a valid geotag.
      }
      onLocation?.({ latitude, longitude, accuracy: position.coords.accuracy });
      setLocation({
        latitude,
        longitude,
        accuracy: position.coords.accuracy,
        placeLabel,
        distanceKm: distanceFromCenter(farmer?.barangayCenter, latitude, longitude),
        capturedAt: formatDateTime(new Date(position.timestamp)),
      });
    } catch (err) {
      Alert.alert("Couldn't get your location", friendlyError(err, "Your location couldn't be read. Go outside or near a window and try again."));
    } finally {
      setLocating(false);
    }
  }

  function openMap() {
    if (!location) return;
    const query = `${location.latitude},${location.longitude}`;
    const url = Platform.select({
      ios: `maps:0,0?q=Harvest Location@${query}`,
      android: `geo:0,0?q=${query}(Harvest Location)`,
      default: `https://www.google.com/maps/search/?api=1&query=${query}`,
    });
    Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`));
  }

  async function takePhoto() {
    if (!location) {
      Alert.alert("Capture your location first", "Capture your GPS location before taking the photo, so the photo can be geotagged.");
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Camera permission needed", `AgriShare needs your camera to take a photo for ${purpose}.`, [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (result.canceled) return;
      setStampJob({ uri: result.assets[0].uri });
    } catch (err) {
      Alert.alert("Photo not taken", friendlyError(err, "The camera couldn't take the photo. Please try again."));
    }
  }

  function retake() {
    setPhotoUri(null);
    setSaved(false);
    onChange(null);
    takePhoto();
  }

  // Flattens the on-screen photo + stamp into one JPEG and uploads that (see
  // CropValidationScreen for why explicit pixel dimensions are needed).
  async function stampReady() {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const uri = await captureRef(stampRef, {
        format: "jpg",
        quality: 0.85,
        result: "tmpfile",
        ...(boxSize ? { width: Math.round(boxSize.width * PixelRatio.get()), height: Math.round(boxSize.height * PixelRatio.get()) } : {}),
      });
      setStampJob(null);
      setPhotoUri(uri);
      const path = await upload(uri);
      setSaved(true);
      onChange({ path, uri, latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy, distanceKm: location.distanceKm });
    } catch (err) {
      setStampJob(null);
      Alert.alert("Photo not saved", friendlyError(err, "The photo couldn't be saved. Please retake it."));
    }
  }

  return (
    <View>
      <View style={styles.rowHeader}>
        <Text style={styles.label}>GPS Location</Text>
        {location && (
          <TouchableOpacity style={styles.smallBtn} onPress={captureLocation} disabled={locating || disabled}>
            <Ionicons name="refresh" size={12} color={colors.primaryDark} />
            <Text style={styles.smallBtnText}>{locating ? "Locating…" : "Recapture"}</Text>
          </TouchableOpacity>
        )}
      </View>
      {location ? (
        <>
          <View style={styles.mapWrap}>
            <WebView source={{ html: mapEmbedHtml(location.latitude, location.longitude) }} style={{ flex: 1 }} />
          </View>
          <Text style={styles.meta}>
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)} · ±{Math.round(location.accuracy)} m ({accuracyRating(location.accuracy)})
          </Text>
          <TouchableOpacity style={styles.linkRow} onPress={openMap}>
            <Ionicons name="open-outline" size={12} color={colors.primaryDark} />
            <Text style={styles.smallBtnText}>Open in Maps app</Text>
          </TouchableOpacity>
          {location.distanceKm > FAR_THRESHOLD_KM && (
            <View style={styles.warn}>
              <Ionicons name="warning" size={14} color={colors.orange} />
              <Text style={styles.warnText}>You're about {location.distanceKm.toFixed(1)} km from Barangay {farmer?.barangay}. Capture this at your farm if you can.</Text>
            </View>
          )}
        </>
      ) : (
        <TouchableOpacity style={styles.placeholder} onPress={captureLocation} disabled={locating || disabled} accessibilityRole="button">
          <Ionicons name="location" size={22} color={colors.primary} />
          <Text style={styles.placeholderText}>{locating ? "Locating…" : "Tap to capture your location"}</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.rowHeader, { marginTop: 12 }]}>
        <Text style={styles.label}>Photo</Text>
        {photoUri && (
          <TouchableOpacity style={styles.smallBtn} onPress={retake} disabled={disabled}>
            <Ionicons name="refresh" size={12} color={colors.primaryDark} />
            <Text style={styles.smallBtnText}>Retake</Text>
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={[styles.photoBox, (!!photoUri || !!stampJob) && styles.photoBoxFilled]}
        onPress={photoUri ? () => setViewer(true) : takePhoto}
        disabled={!!stampJob || disabled}
        onLayout={(e) => setBoxSize(e.nativeEvent.layout)}
        accessibilityRole="button"
        accessibilityLabel={photoUri ? "View the photo" : "Take a geotagged photo"}
      >
        {stampJob && location ? (
          <View ref={stampRef} collapsable={false} style={boxSize ? { width: boxSize.width, height: boxSize.height } : StyleSheet.absoluteFillObject}>
            <Image source={{ uri: stampJob.uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" onLoadEnd={stampReady} />
            <View style={styles.stamp}>
              <Text style={styles.stampHead}>{stampTitle}</Text>
              <Text style={styles.stampPlace}>{location.placeLabel || "Unknown location"}</Text>
              <Text style={styles.stampLine}>
                {location.latitude.toFixed(6)}°, {location.longitude.toFixed(6)}° · ±{Math.round(location.accuracy)} m
              </Text>
              <Text style={styles.stampMeta}>{location.capturedAt} · RSBSA {rsbsaNo ?? "—"}</Text>
            </View>
          </View>
        ) : photoUri ? (
          <>
            <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="cover" />
            <View style={styles.viewPill}>
              <Ionicons name={saved ? "checkmark-circle" : "hourglass-outline"} size={11} color="#fff" />
              <Text style={styles.viewPillText}>{saved ? "Saved · tap to view" : "Saving…"}</Text>
            </View>
          </>
        ) : (
          <>
            <Ionicons name="camera" size={26} color={colors.textMuted} />
            <Text style={styles.caption}>{location ? "Tap to take a geotagged photo" : "Capture your location first"}</Text>
          </>
        )}
      </TouchableOpacity>

      <Modal visible={viewer} transparent animationType="fade" onRequestClose={() => setViewer(false)}>
        <TouchableOpacity style={styles.viewer} activeOpacity={1} onPress={() => setViewer(false)}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewer(false)} accessibilityLabel="Close photo">
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          {photoUri && <Image source={{ uri: photoUri }} style={{ width: "100%", height: "80%" }} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, minHeight: 24 },
  label: { fontSize: 10.5, fontWeight: "700", color: colors.textMuted },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: sizes.minTouchTarget, paddingHorizontal: 4 },
  smallBtnText: { fontSize: 11, color: colors.primaryDark, fontWeight: "600" },
  placeholder: {
    minHeight: 96,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  placeholderText: { fontSize: 11.5, color: colors.primaryDark, fontWeight: "600" },
  mapWrap: { height: 170, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  meta: { fontSize: 10.5, color: colors.textMuted, marginTop: 6 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: sizes.minTouchTarget },
  warn: { flexDirection: "row", gap: 6, backgroundColor: colors.orangeBg, borderRadius: radius.sm, padding: 8, marginTop: 4 },
  warnText: { flex: 1, fontSize: 10.5, color: colors.text, lineHeight: 15 },
  photoBox: {
    height: 210,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
  },
  photoBoxFilled: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderStyle: "solid" },
  caption: { fontSize: 11.5, color: colors.textMuted },
  preview: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  viewPill: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(10,25,15,0.72)",
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  viewPillText: { color: "#fff", fontWeight: "700", fontSize: 10 },
  stamp: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,25,15,0.68)", paddingVertical: 6, paddingHorizontal: 10 },
  stampHead: { color: "rgba(255,255,255,0.85)", fontSize: 7.5, fontWeight: "700", letterSpacing: 0.3, marginBottom: 2 },
  stampPlace: { color: "#fff", fontSize: 11, fontWeight: "800", marginBottom: 1 },
  stampLine: { color: "rgba(255,255,255,0.92)", fontSize: 9, marginBottom: 1 },
  stampMeta: { color: "rgba(255,255,255,0.75)", fontSize: 8 },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  viewerClose: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 1,
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    borderRadius: sizes.minTouchTarget / 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
});
