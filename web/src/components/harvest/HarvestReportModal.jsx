import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import DateInput from "../ui/DateInput.jsx";
import FarmerSearchField from "../farmers/FarmerSearchField.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { listCommodities } from "../../lib/api/commodities.js";
import { HARVEST_LIMITS, findRecentHarvest, harvestCrops, updateHarvestReport } from "../../lib/api/harvest.js";
import { formatHectares } from "../../lib/allocation.js";
import { formatDate, todayIso } from "../../lib/dates.js";
import { friendlyError } from "../../lib/friendlyError.js";

const Required = () => <span style={{ color: "var(--agri-red)" }}>*</span>;
const twoDecimals = (text) => /^\d+(\.\d{1,2})?$/.test(text.trim());
const kgText = (n) => `${(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg/ha`;

function initialForm(report) {
  return {
    commodityId: String(report.commodityId),
    areaHa: String(report.areaHa),
    yieldKg: String(report.yieldKg),
    harvestDate: report.harvestDate,
    remarks: report.remarks,
  };
}

// The same rules the database checks, as plain messages per field.
function validate(form, { farmer, crop, dateTyped }) {
  const e = {};
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

// Correcting a harvest report before it's verified (the MAO Admin, or the
// Farmers' Association President for a report they filed earlier). Harvest
// reports themselves are submitted by farmers from the mobile app.
// Kilograms only.
export default function HarvestReportModal({ report, onClose, onSaved }) {
  const farmer = { id: report.farmerId, firstName: report.farmerName, lastName: "", rsbsaNo: report.rsbsaNo, barangay: report.barangay, sitioPurok: report.sitioPurok, farmSize: report.farmSize };
  const [form, setForm] = useState(() => initialForm(report));
  const [crops, setCrops] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEscapeToClose(!saving, onClose);

  useEffect(() => {
    listCommodities()
      .then((rows) => {
        const list = harvestCrops(rows);
        // A report being corrected keeps its crop even if it's no longer offered.
        if (!list.some((c) => String(c.id) === String(report.commodityId))) list.push({ id: report.commodityId, name: report.commodityName });
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
    if (!form.commodityId || !form.harvestDate) return undefined;
    let cancelled = false;
    findRecentHarvest({ farmerId: report.farmerId, commodityId: form.commodityId, harvestDate: form.harvestDate, excludeId: report.id })
      .then((r) => { if (!cancelled) setRecent(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [report.farmerId, form.commodityId, form.harvestDate, report.id]);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
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
      onSaved(await updateHarvestReport(report, form));
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this harvest report. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const fieldError = (key) => errors[key] && <div className="invalid-feedback d-block">{errors[key]}</div>;
  const perHa = twoDecimals(form.areaHa) && twoDecimals(form.yieldKg) && Number(form.areaHa) > 0 && Number(form.yieldKg) > 0 ? Number(form.yieldKg) / Number(form.areaHa) : null;
  const rejected = report.statusKey === "rejected";
  const title = rejected ? "Correct and Resubmit" : "Edit Harvest Report";

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
          {rejected && report.reviewRemarks && (
            <div className="agri-warning-box" role="status" style={{ marginTop: 0, marginBottom: 14 }}>
              <div><strong>MAO remarks:</strong> {report.reviewRemarks}</div>
            </div>
          )}

          <label className="agri-form-label" htmlFor="harvest-farmer">Farmer</label>
          <FarmerSearchField id="harvest-farmer" farmer={farmer} onPick={() => {}} disabled={saving} locked />

          <div className="row g-3 mt-0">
            <div className="col-12 col-sm-5">
              <label className="agri-form-label" htmlFor="harvest-date">Harvest Date <Required /></label>
              <DateInput id="harvest-date" value={form.harvestDate} max={todayIso()} onChange={(v) => update("harvestDate", v)} invalid={!!errors.harvestDate} disabled={saving} aria-label="Harvest date" />
              {fieldError("harvestDate")}
            </div>
            <div className="col-12 col-sm-7">
              <label className="agri-form-label" htmlFor="harvest-crop">Crop <Required /></label>
              <select id="harvest-crop" className={`form-select${errors.commodityId ? " is-invalid" : ""}`} value={form.commodityId} onChange={(e) => update("commodityId", e.target.value)} disabled={saving || !crops}>
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
                {farmer.firstName} already reported {crop?.name ?? "this crop"} harvested {formatDate(recent.harvestDate)} ({recent.yieldKg?.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg, {recent.status}), within 60 days of this date. Check that this isn&apos;t the same harvest. You can still save it.
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
                onChange={(e) => update("areaHa", e.target.value)}
                disabled={saving}
                placeholder="e.g. 1.50"
              />
              {fieldError("areaHa") || (farmer.farmSize > 0 && <div className="agri-field-hint">Farm size {formatHectares(farmer.farmSize)}</div>)}
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
        </div>

        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary" disabled={saving || !crops}>
            {saving ? "Saving…" : rejected ? "Resubmit" : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
