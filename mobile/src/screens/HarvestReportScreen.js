import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import ScreenHeader from "../components/ScreenHeader";
import GeotagPhotoCapture from "../components/GeotagPhotoCapture";
import { colors, radius, sizes } from "../theme";
import { useAuth } from "../context/AuthContext";
import { listCommodities } from "../lib/api/commodities";
import { listMyDistributions } from "../lib/api/distributions";
import { SEASONS, guessSeason, harvestCrops, submitHarvestReport, updateHarvestReport, uploadHarvestPhoto } from "../lib/api/harvest";
import { formatDate, formatDateLong, maskTypedDate, todayIso, typedToIso } from "../lib/dates";
import { friendlyError } from "../lib/friendlyError";

const MAX_REMARKS = 500;
const twoDecimals = (text) => /^\d+(\.\d{1,2})?$/.test(text.trim());
const isoToTyped = (iso) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const fmt = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

// Report Harvest (new) or Resubmit (route.params.report, a Returned report).
// Kilograms only. The geotagged photo is optional but helps the MAO verify.
export default function HarvestReportScreen({ navigation, route }) {
  const { farmer } = useAuth();
  const editing = route?.params?.report ?? null;
  const farmSize = farmer?.farmSizeHa ?? 0;
  const today = todayIso();
  const start = editing ? { season: editing.season, seasonYear: editing.seasonYear } : guessSeason(today);

  const [crops, setCrops] = useState(null);
  const [claims, setClaims] = useState([]);
  const [season, setSeason] = useState(start.season);
  const [seasonYear, setSeasonYear] = useState(String(start.seasonYear));
  const [commodityId, setCommodityId] = useState(editing?.commodityId ?? null);
  const [typeId, setTypeId] = useState(editing?.typeId ?? null);
  const [areaHa, setAreaHa] = useState(editing ? String(editing.areaHa) : farmSize > 0 ? farmSize.toFixed(2) : "");
  const [yieldKg, setYieldKg] = useState(editing ? String(editing.yieldKg) : "");
  const [harvestDate, setHarvestDate] = useState(isoToTyped(editing?.harvestDate ?? today));
  const [claimId, setClaimId] = useState(editing?.claimId ?? null);
  const [remarks, setRemarks] = useState(editing?.remarks ?? "");
  const [photo, setPhoto] = useState(null);
  const [gps, setGps] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([listCommodities(), listMyDistributions()]).then(([items, mine]) => {
      if (cancelled) return;
      if (items.status === "fulfilled") {
        const list = harvestCrops(items.value);
        setCrops(list);
        if (!editing) {
          // Start from the farmer's own Program / type.
          const own = list.find((c) => c.types.some((t) => t.id === farmer?.typeId));
          const first = own ?? (list.length === 1 ? list[0] : null);
          if (first) {
            setCommodityId(first.id);
            setTypeId(own ? farmer.typeId : first.types[0]?.id ?? null);
          }
        }
      } else {
        setCrops([]);
        setLoadError(friendlyError(items.reason, "The crop list couldn't be loaded. Go back and try again."));
      }
      if (mine.status === "fulfilled") setClaims(mine.value.filter((d) => d.status === "Completed"));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crop = crops?.find((c) => c.id === commodityId) ?? null;
  const types = crop?.types ?? [];
  const dateIso = typedToIso(harvestDate);
  const perHa = twoDecimals(areaHa) && twoDecimals(yieldKg) && Number(areaHa) > 0 && Number(yieldKg) > 0 ? Number(yieldKg) / Number(areaHa) : null;
  // Distributions of this crop the farmer received (optional link).
  const cropClaims = crop ? claims.filter((d) => d.item === crop.name).slice(0, 4) : [];

  function chooseCrop(c) {
    setCommodityId(c.id);
    const own = c.types.find((t) => t.id === farmer?.typeId);
    setTypeId((own ?? c.types[0])?.id ?? null);
    setClaimId(null);
    setErrors((e) => ({ ...e, crop: undefined, type: undefined }));
  }

  function validate() {
    const e = {};
    const thisYear = Number(today.slice(0, 4));
    if (!/^\d{4}$/.test(seasonYear.trim()) || Number(seasonYear) < 2000 || Number(seasonYear) > thisYear + 1) e.year = `Enter a year from 2000 to ${thisYear + 1}.`;
    if (!crop) e.crop = "Choose the crop you harvested.";
    else if (types.length && !typeId) e.type = "Choose the program / type.";
    if (!areaHa.trim()) e.area = "Enter the area you harvested.";
    else if (!twoDecimals(areaHa) || Number(areaHa) <= 0) e.area = "Enter the area in hectares, more than 0 (for example 1.5).";
    else if (farmSize > 0 && Number(areaHa) > farmSize) e.area = `The area harvested can't be more than your farm size (${farmSize.toFixed(2)} ha).`;
    if (!yieldKg.trim()) e.kg = "Enter how many kilograms you harvested.";
    else if (!twoDecimals(yieldKg) || Number(yieldKg) <= 0) e.kg = "Enter the harvest in kilograms, more than 0 (for example 4500).";
    if (!dateIso) e.date = "Enter the harvest date as MM/DD/YYYY, for example 10/27/2026.";
    else if (dateIso > today) e.date = "The harvest date can't be in the future.";
    if (remarks.length > MAX_REMARKS) e.remarks = `Keep the remarks to ${MAX_REMARKS} characters or fewer.`;
    return e;
  }

  async function handleSubmit() {
    if (submittingRef.current) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      Alert.alert("Check your harvest report", Object.values(found)[0]);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const form = { season, seasonYear, commodityId, typeId: types.length ? typeId : null, areaHa, yieldKg, harvestDate: dateIso, claimId, remarks, photo, gps: photo ?? gps };
    try {
      if (editing) {
        await updateHarvestReport(editing.id, form);
        Alert.alert("Resubmitted", "Your corrected harvest report was sent back to the MAO.");
      } else {
        await submitHarvestReport(farmer.farmerId, form);
        Alert.alert("Harvest reported", "Your harvest report was sent to the MAO for verification. Your Farmers' Association President can see it too.");
      }
      navigation.goBack();
    } catch (err) {
      Alert.alert(editing ? "Not resubmitted" : "Not sent", friendlyError(err, "Your harvest report couldn't be sent. Please try again."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // Editing a field clears its message.
  const edited = (key, setter) => (value) => {
    setter(value);
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fieldError = (key) => (errors[key] ? <Text style={styles.error}>{errors[key]}</Text> : null);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={editing ? "Resubmit Harvest Report" : "Report Harvest"} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!!loadError && <Text style={[styles.error, { marginBottom: 10 }]}>{loadError}</Text>}
          {editing?.reviewRemarks ? (
            <View style={styles.remarksBox}>
              <Text style={styles.remarksLabel}>MAO remarks</Text>
              <Text style={styles.remarksText}>{editing.reviewRemarks}</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Harvest Details</Text>
            <Text style={styles.muted}>
              {farmer ? `${farmer.firstName} ${farmer.lastName}` : ""} · RSBSA {farmer?.rsbsaNo ?? "—"} · Farm size {farmSize > 0 ? `${farmSize.toFixed(2)} ha` : "not recorded"}
            </Text>

            <Text style={styles.label}>Season *</Text>
            <View style={styles.row}>
              <View style={[styles.chipRow, { flex: 1 }]}>
                {SEASONS.map((s) => (
                  <TouchableOpacity key={s.value} onPress={() => setSeason(s.value)} style={[styles.chip, season === s.value && styles.chipActive]} accessibilityRole="radio" accessibilityState={{ selected: season === s.value }}>
                    <Text style={[styles.chipText, season === s.value && styles.chipTextActive]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={[styles.input, styles.yearInput, errors.year && styles.inputInvalid]}
                value={seasonYear}
                onChangeText={(v) => edited("year", setSeasonYear)(v.replace(/\D/g, "").slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                accessibilityLabel="Season year"
              />
            </View>
            {fieldError("year")}

            <Text style={styles.label}>Crop *</Text>
            <View style={styles.chipRow}>
              {crops === null ? (
                <Text style={styles.muted}>Loading…</Text>
              ) : (
                crops.map((c) => (
                  <TouchableOpacity key={c.id} onPress={() => chooseCrop(c)} style={[styles.chip, commodityId === c.id && styles.chipActive]}>
                    <Text style={[styles.chipText, commodityId === c.id && styles.chipTextActive]} numberOfLines={1}>{c.name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
            {fieldError("crop")}

            {types.length > 0 && (
              <>
                <Text style={styles.label}>Program / Type *</Text>
                <View style={styles.chipRow}>
                  {types.map((t) => (
                    <TouchableOpacity key={t.id} onPress={() => { setTypeId(t.id); setErrors((e) => ({ ...e, type: undefined })); }} style={[styles.chip, typeId === t.id && styles.chipActive]}>
                      <Text style={[styles.chipText, typeId === t.id && styles.chipTextActive]} numberOfLines={1}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {fieldError("type")}
              </>
            )}

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Area Harvested (ha) *</Text>
                <TextInput style={[styles.input, styles.num, errors.area && styles.inputInvalid]} value={areaHa} onChangeText={edited("area", setAreaHa)} keyboardType="decimal-pad" placeholder="e.g. 1.5" placeholderTextColor={colors.textFaint} accessibilityLabel="Area harvested in hectares" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Harvest (kg) *</Text>
                <TextInput style={[styles.input, styles.num, errors.kg && styles.inputInvalid]} value={yieldKg} onChangeText={edited("kg", setYieldKg)} keyboardType="decimal-pad" placeholder="e.g. 4500" placeholderTextColor={colors.textFaint} accessibilityLabel="Harvest in kilograms" />
              </View>
            </View>
            {fieldError("area")}
            {fieldError("kg")}
            {!errors.area && !errors.kg && <Text style={styles.hint}>{perHa !== null ? `Yield: ${fmt(Math.round(perHa * 100) / 100)} kg per hectare` : "Your yield per hectare is computed for you."}</Text>}

            <Text style={styles.label}>Harvest Date (Month / Day / Year) *</Text>
            <TextInput
              style={[styles.input, (errors.date || (harvestDate.length === 10 && (!dateIso || dateIso > today))) && styles.inputInvalid]}
              value={harvestDate}
              onChangeText={(t) => edited("date", setHarvestDate)(maskTypedDate(t))}
              placeholder="MM/DD/YYYY"
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              maxLength={10}
              accessibilityLabel="Harvest date, month day year"
            />
            {errors.date ? fieldError("date") : harvestDate.length === 10 && dateIso && dateIso <= today ? <Text style={styles.hint}>Harvested on {formatDateLong(dateIso)}</Text> : null}

            {cropClaims.length > 0 && (
              <>
                <Text style={styles.label}>From a distribution you received (optional)</Text>
                <View style={styles.chipRow}>
                  <TouchableOpacity onPress={() => setClaimId(null)} style={[styles.chip, claimId === null && styles.chipActive]}>
                    <Text style={[styles.chipText, claimId === null && styles.chipTextActive]}>None</Text>
                  </TouchableOpacity>
                  {cropClaims.map((d) => (
                    <TouchableOpacity key={d.claimId} onPress={() => setClaimId(d.claimId)} style={[styles.chip, claimId === d.claimId && styles.chipActive]}>
                      <Text style={[styles.chipText, claimId === d.claimId && styles.chipTextActive]} numberOfLines={1}>{d.program} · {formatDate(d.date)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.label}>Remarks (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64, textAlignVertical: "top" }, errors.remarks && styles.inputInvalid]}
              value={remarks}
              onChangeText={edited("remarks", setRemarks)}
              multiline
              maxLength={MAX_REMARKS}
              placeholder="For example: affected by the October typhoon"
              placeholderTextColor={colors.textFaint}
            />
            {fieldError("remarks")}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Photo with GPS (recommended)</Text>
            <Text style={[styles.muted, { marginBottom: 10 }]}>
              {editing?.photoPath ? "A photo is already attached. Take a new one only if the MAO asked for it." : "A geotagged photo of your harvest helps the MAO verify it."}
            </Text>
            <GeotagPhotoCapture
              stampTitle="AGRISHARE HARVEST REPORT"
              rsbsaNo={farmer?.rsbsaNo}
              purpose="your harvest report"
              upload={(uri) => uploadHarvestPhoto(farmer.farmerId, uri)}
              onChange={setPhoto}
              onLocation={setGps}
              disabled={submitting}
            />
          </View>

          <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting || crops === null} accessibilityRole="button">
            <Ionicons name="send" size={15} color="#fff" />
            <Text style={styles.submitText}>{submitting ? "Sending…" : editing ? "Resubmit to the MAO" : "Submit Harvest Report"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: "700", color: colors.text, marginBottom: 2 },
  muted: { fontSize: 11, color: colors.textMuted, lineHeight: 16 },
  label: { fontSize: 10.5, fontWeight: "700", color: colors.textMuted, marginTop: 12, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    minHeight: sizes.minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: "100%",
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 11.5, color: colors.text, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  input: {
    minHeight: sizes.minTouchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.card,
  },
  num: { textAlign: "right" },
  yearInput: { width: 84, textAlign: "center" },
  inputInvalid: { borderColor: colors.red },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  error: { fontSize: 11, color: colors.red, marginTop: 4 },
  remarksBox: { backgroundColor: colors.redBg, borderRadius: radius.md, padding: 10, marginBottom: 12 },
  remarksLabel: { fontSize: 10, fontWeight: "700", color: colors.red, marginBottom: 2 },
  remarksText: { fontSize: 12, color: colors.text, lineHeight: 17 },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    minHeight: sizes.minTouchTarget,
    paddingVertical: 13,
  },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 13.5 },
});
