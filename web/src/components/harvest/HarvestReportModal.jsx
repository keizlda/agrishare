import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ImageIcon, X } from "lucide-react";
import DateInput from "../ui/DateInput.jsx";
import FarmerSearchField from "../farmers/FarmerSearchField.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { listCommodities } from "../../lib/api/commodities.js";
import {
  HARVEST_LIMITS,
  PHOTO_TYPES,
  createHarvestReport,
  findRecentHarvest,
  harvestCrops,
  updateHarvestReport,
  validatePhoto,
} from "../../lib/api/harvest.js";
import { formatHectares } from "../../lib/allocation.js";
import { formatDate, todayIso } from "../../lib/dates.js";
import { friendlyError } from "../../lib/friendlyError.js";

const Required = () => <span style={{ color: "var(--agri-red)" }}>*</span>;
const twoDecimals = (text) => /^\d+(\.\d{1,2})?$/.test(text.trim());
const kgText = (n) => `${(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/ha`;

function initialForm(report) {
  if (report) {
    return {
      commodityId: String(report.commodityId),
      areaHa: String(report.areaHa),
      yieldKg: String(report.yieldKg),
      harvestDate: report.harvestDate,
      remarks: report.remarks,
    };
  }
  return { commodityId: "", areaHa: "", yieldKg: "", harvestDate: todayIso(), remarks: "" };
}

// The same rules the database checks, as plain messages per field.
function validate(form, { farmer, crop, dateTyped }) {
  const e = {};
  if (!farmer) e.farmer = "Search for the farmer this report is for.";
  if (!crop) e.commodityId = "Choose the crop.";
  if (!form.areaHa.trim()) e.areaHa = "Enter the area harvested.";
  else if (!twoDecimals(form.areaHa) || Number(form.areaHa) <= 0) e.areaHa = "Enter the area in hectares, more than 0 (up to 2 decimals).";
  else if (farmer?.farmSize > 0 && Number(form.areaHa) > farmer.farmSize) e.areaHa = `The area harvested can't be more than the farm size (${farmer.farmSize.toFixed(2)} ha).`;
  if (!form.yieldKg.trim()) e.yieldKg = "Enter the harvest in kilograms.";
  else if (!twoDecimals(form.yieldKg) || Number(form.yieldKg) <= 0) e.yieldKg = "Enter the harvest in kg, more than 0 (up to 2 decimals).";
  else if (Number(form.yieldKg) > HARVEST_LIMITS.maxKg) e.yieldKg = "That harvest looks too large. Check the number.";
  if (dateTyped && !form.harvestDate) e.harvestDate = "Enter the date as MM/DD/YYYY.";
  else if (!form.harvestDate) e.harvestDate = "Enter the harvest date.";
  else if (form.harvestDate > todayIso()) e.harvestDate = "The harvest date can't be in the future.";
  if (form.remarks.trim().length > HARVEST_LIMITS.remarks) e.remarks = `Keep the remarks to ${HARVEST_LIMITS.remarks} characters or fewer.`;
  return e;
}

// "Add Harvest Report" (Farmers' Association President or MAO Admin, for a
// farmer — e.g. one without the app) and correcting one before it's
// verified. Kilograms only.
export default function HarvestReportModal({ report, presetFarmer = null, onClose, onSaved }) {
  const editing = !!report;
  const [farmer, setFarmer] = useState(() =>
    report
      ? { id: report.farmerId, firstName: report.farmerName, lastName: "", rsbsaNo: report.rsbsaNo, barangay: report.barangay, sitioPurok: report.sitioPurok, farmSize: report.farmSize }
      : presetFarmer,
  );
  const [form, setForm] = useState(() => initialForm(report));
  const [areaTouched, setAreaTouched] = useState(editing);
  const [crops, setCrops] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const fileRef = useRef(null);

  useEscapeToClose(!saving, onClose);

  useEffect(() => {
    listCommodities()
      .then((rows) => {
        const list = harvestCrops(rows);
        // A report being corrected keeps its crop even if it's no longer offered.
        if (report && !list.some((c) => String(c.id) === String(report.commodityId))) list.push({ id: report.commodityId, name: report.commodityName });
        setCrops(list);
      })
      .catch((err) => setFormError(friendlyError(err, "Couldn't load the crops. Close this form and try again.")));
    // Loaded once, when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crop = crops?.find((c) => String(c.id) === form.commodityId) ?? null;

  // Another report by this farmer for the same crop within 60 days of this
  // harvest date: a warning, not a block.
  const [recent, setRecent] = useState(null);
  useEffect(() => {
    setRecent(null);
    if (!farmer?.id || !form.commodityId || !form.harvestDate) return undefined;
    let cancelled = false;
    findRecentHarvest({ farmerId: farmer.id, commodityId: form.commodityId, harvestDate: form.harvestDate, excludeId: report?.id ?? null })
      .then((r) => { if (!cancelled) setRecent(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [farmer?.id, form.commodityId, form.harvestDate, report?.id]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
  }

  // A picked farmer fills in their crop (their Seed program) and their farm
  // size as the area harvested.
  useEffect(() => {
    if (editing || !farmer || !crops) return;
    const ownCrop = crops.find((c) => String(c.id) === String(farmer.seedProgramId ?? ""));
    setForm((f) => ({
      ...f,
      commodityId: ownCrop ? String(ownCrop.id) : f.commodityId || (crops.length === 1 ? String(crops[0].id) : ""),
      areaHa: !areaTouched && farmer.farmSize > 0 ? farmer.farmSize.toFixed(2) : f.areaHa,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmer?.id, crops]);

  function chooseCrop(id) {
    setForm((f) => ({ ...f, commodityId: id }));
    setErrors((x) => ({ ...x, commodityId: undefined }));
  }

  async function pickPhoto(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const problem = await validatePhoto(picked);
    setErrors((x) => ({ ...x, photo: problem ?? undefined }));
    if (!problem) setPhoto(picked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (savingRef.current || !crops) return;
    const dateTyped = document.getElementById("harvest-date")?.value?.trim().length > 0;
    const found = validate(form, { farmer, crop, dateTyped });
    setErrors(found);
    setFormError("");
    if (Object.keys(found).length > 0) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = editing ? await updateHarvestReport(report, form) : await createHarvestReport(farmer.id, form, photo);
      onSaved(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this harvest report. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const fieldError = (key) => errors[key] && <div className="invalid-feedback d-block">{errors[key]}</div>;
  const perHa = twoDecimals(form.areaHa) && twoDecimals(form.yieldKg) && Number(form.areaHa) > 0 && Number(form.yieldKg) > 0 ? Number(form.yieldKg) / Number(form.areaHa) : null;
  const title = editing ? (report.statusKey === "returned" ? "Correct and Resubmit" : "Edit Harvest Report") : "Add Harvest Report";

  return (
    <div className="agri-modal-backdrop" onClick={saving ? undefined : onClose}>
      <form
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "580px" }}
        role="dialog"
        aria-label={title}
        onSubmit={handleSubmit}
        noValidate
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">{title}</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={saving}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {formError && (
            <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{formError}</div>
          )}
          {editing && report.statusKey === "returned" && report.reviewRemarks && (
            <div className="agri-warning-box" role="status" style={{ marginTop: 0, marginBottom: 14 }}>
              <div><strong>MAO remarks:</strong> {report.reviewRemarks}</div>
            </div>
          )}
          {!editing && (
            <div className="agri-muted" style={{ fontSize: "0.78rem", marginBottom: 14 }}>
              For a farmer without the app, or a harvest reported to you in person. It's recorded as filed by you; the MAO verifies it. The farmer is notified if they have an account.
            </div>
          )}

          <label className="agri-form-label" htmlFor="harvest-farmer">Farmer <Required /></label>
          <FarmerSearchField id="harvest-farmer" farmer={farmer} onPick={(f) => { setFarmer(f); setErrors((x) => ({ ...x, farmer: undefined, areaHa: undefined })); }} disabled={saving} locked={editing || !!presetFarmer} invalid={!!errors.farmer} />
          {fieldError("farmer")}

          <div className="row g-3 mt-0">
            <div className="col-12 col-sm-5">
              <label className="agri-form-label" htmlFor="harvest-date">Harvest Date <Required /></label>
              <DateInput id="harvest-date" value={form.harvestDate} max={todayIso()} onChange={(v) => update("harvestDate", v)} invalid={!!errors.harvestDate} disabled={saving} aria-label="Harvest date" />
              {fieldError("harvestDate")}
            </div>
            <div className="col-12 col-sm-7">
              <label className="agri-form-label" htmlFor="harvest-crop">Crop <Required /></label>
              <select id="harvest-crop" className={`form-select${errors.commodityId ? " is-invalid" : ""}`} value={form.commodityId} onChange={(e) => chooseCrop(e.target.value)} disabled={saving || !crops}>
                <option value="">{crops ? "Choose the crop" : "Loading…"}</option>
                {crops?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {fieldError("commodityId")}
            </div>
          </div>
          {recent && (
            <div className="agri-warning-box" role="status">
              <AlertTriangle size={14} style={{ flex: "none", marginTop: 2 }} />
              <div>
                {farmer?.firstName ? `${farmer.firstName} already` : "This farmer already"} reported {crop?.name ?? "this crop"} harvested {formatDate(recent.harvestDate)} ({recent.yieldKg?.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg, {recent.status}), within 60 days of this date. Check that this isn&apos;t the same harvest. You can still save it.
              </div>
            </div>
          )}

          <div className="row g-3 mt-0">
            <div className="col-6">
              <label className="agri-form-label" htmlFor="harvest-area">Area Harvested (ha) <Required /></label>
              <input
                id="harvest-area"
                inputMode="decimal"
                className={`form-control text-end${errors.areaHa ? " is-invalid" : ""}`}
                value={form.areaHa}
                onChange={(e) => { setAreaTouched(true); update("areaHa", e.target.value); }}
                disabled={saving}
                placeholder="e.g. 1.50"
              />
              {fieldError("areaHa") || (farmer?.farmSize > 0 && <div className="agri-field-hint">Farm size {formatHectares(farmer.farmSize)}</div>)}
            </div>
            <div className="col-6">
              <label className="agri-form-label" htmlFor="harvest-kg">Harvest (kg) <Required /></label>
              <input id="harvest-kg" inputMode="decimal" className={`form-control text-end${errors.yieldKg ? " is-invalid" : ""}`} value={form.yieldKg} onChange={(e) => update("yieldKg", e.target.value)} disabled={saving} placeholder="e.g. 4,500" />
              {fieldError("yieldKg") || <div className="agri-field-hint" aria-live="polite">{perHa !== null ? `Yield: ${kgText(perHa)}` : "Yield per hectare is computed for you."}</div>}
            </div>
          </div>

          <label className="agri-form-label" htmlFor="harvest-remarks" style={{ marginTop: 14 }}>Remarks</label>
          <textarea id="harvest-remarks" className={`form-control${errors.remarks ? " is-invalid" : ""}`} rows={2} maxLength={HARVEST_LIMITS.remarks} value={form.remarks} onChange={(e) => update("remarks", e.target.value)} disabled={saving} placeholder="Optional, e.g. affected by the October typhoon" />
          {fieldError("remarks")}

          {!editing && (
            <>
              <div className="agri-form-label" style={{ marginTop: 14 }}>Photo (optional)</div>
              {photo ? (
                <div className="agri-attachment-chip">
                  <ImageIcon size={16} />
                  <span className="agri-attachment-name">{photo.name}</span>
                  <button type="button" className="agri-icon-btn" aria-label="Remove photo" onClick={() => setPhoto(null)} disabled={saving}><X size={14} /></button>
                </div>
              ) : (
                <button type="button" className="agri-ann-upload" onClick={() => fileRef.current?.click()} disabled={saving}>
                  <Camera size={18} /> Attach a photo of the harvest
                  <span className="agri-muted" style={{ fontSize: "0.72rem" }}>JPG, PNG or WebP, up to 10 MB</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept={PHOTO_TYPES.join(",")} hidden onChange={pickPhoto} />
              {errors.photo && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginTop: 4 }}>{errors.photo}</div>}
            </>
          )}
        </div>

        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary" disabled={saving || !crops}>
            {saving ? "Saving…" : editing ? (report.statusKey === "returned" ? "Resubmit" : "Save Changes") : "Submit Report"}
          </button>
        </div>
      </form>
    </div>
  );
}
