import { useEffect, useRef, useState } from "react";
import { useBarangays } from "../../hooks/useBarangays.js";
import { inBarangay } from "../../lib/listMatch.js";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Image as ImageIcon, Inbox, Pencil, ShieldAlert, Trash2, X, XCircle } from "lucide-react";
import Pill from "../ui/Pill.jsx";
import FarmerAvatar from "../ui/FarmerAvatar.jsx";
import RowActionsMenu from "../ui/RowActionsMenu.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import HarvestReportModal from "../harvest/HarvestReportModal.jsx";
import KindTag from "./KindTag.jsx";
import { getSignedPhotoUrl, rejectSubmission, approveSubmission } from "../../lib/api/cropValidation.js";
import { getHarvestPhotoUrl, removeHarvestReport, reviewHarvestReport } from "../../lib/api/harvest.js";
import { plantingDetails, toItem } from "../../lib/validationInbox.js";
import { formatHectares, formatKg } from "../../lib/allocation.js";
import { formatDate, formatDateTime } from "../../lib/dates.js";
import { friendlyError } from "../../lib/friendlyError.js";

// The farmer's barangay's approximate center, when one is on file (there are
// no per-parcel coordinates): used to flag a photo taken far away.
function distanceKm(lat, lng, ref) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat - ref.lat) / 2) ** 2 + Math.cos(rad(ref.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lng - ref.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const fmt = (n, d = 2) => (n == null ? null : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const MAX_REMARKS = 500;

// One opened submission, in the inbox's card (like an opened email): back,
// "X of Y" with previous / next in the current filtered list, a ⋯ menu,
// the farmer, the details, photo and map, the timeline, and — for the MAO
// Admin while Pending — the decision bar.
export default function SubmissionView({ item, loading, loadError, list, user, isMAO, onBack, onOpen, onChanged, onRemoved, onToast }) {
  const barangays = useBarangays();
  const [photoUrl, setPhotoUrl] = useState(null);
  const [lightbox, setLightbox] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [remarksError, setRemarksError] = useState("");
  const [saving, setSaving] = useState(null); // "approve" | "decline" | "remove"
  const savingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remarksRef = useRef(null);

  const index = item ? list.findIndex((i) => i.key === item.key) : -1;
  const prev = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;

  // Escape goes back to the list — unless a dialog, photo or menu is open.
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (lightbox || editing || confirmRemove || document.querySelector(".agri-modal-backdrop, .agri-row-menu, [role=menu]")) return;
      onBack();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox, editing, confirmRemove, onBack]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const close = (e) => e.key === "Escape" && (e.preventDefault(), setLightbox(false));
    document.addEventListener("keydown", close, true);
    return () => document.removeEventListener("keydown", close, true);
  }, [lightbox]);

  const raw = item?.raw;
  const photoPath = raw?.photoPath ?? null;
  useEffect(() => {
    setPhotoUrl(null);
    if (!photoPath) return undefined;
    let cancelled = false;
    (item.kind === "planting" ? getSignedPhotoUrl(photoPath) : getHarvestPhotoUrl(photoPath)).then((url) => !cancelled && setPhotoUrl(url)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item?.kind, photoPath]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    return (
      <div className="agri-card agri-fill-card agri-vinbox">
        <div className="agri-vi-topbar">
          <button type="button" className="agri-link-btn agri-vi-back" onClick={onBack}><ArrowLeft size={15} /> Back to validation</button>
        </div>
        {loadError ? (
          <div className="agri-pill red" role="alert" style={{ display: "block", margin: 16, padding: "8px 12px" }}>{loadError}</div>
        ) : loading ? (
          <div className="agri-muted text-center py-5">Loading submission…</div>
        ) : (
          <EmptyState icon={Inbox} title="This submission isn't available" hint="It may have been removed. Go back to the list to see the others." />
        )}
      </div>
    );
  }

  const planting = item.kind === "planting";
  const pending = item.group === "pending";
  const canReview = isMAO && pending;
  // Both kinds: Approve / Reject (Pending → Approved or Rejected).
  const words = { approve: "Approve", decline: "Reject", approved: "Approved", declined: "Rejected", waiting: "approve" };
  const ownFiling = !planting && raw.submittedBy === user?.id;
  const canEdit = !planting && raw.statusKey !== "approved" && (isMAO || ownFiling);
  const canRemove = !planting && (isMAO || (ownFiling && raw.statusKey !== "approved"));
  const lat = raw.latitude;
  const lng = raw.longitude;
  const farmerBarangay = barangays.find((b) => inBarangay(barangays, String(b.id), item.barangayId, item.barangay));
  const km = lat != null && lng != null && farmerBarangay?.center ? distanceKm(lat, lng, farmerBarangay.center) : null;

  // The next pending submission after this one in the current list (or
  // before it), from the list as it was before this decision.
  function nextPending() {
    const after = list.slice(index + 1).find((i) => i.group === "pending" && i.key !== item.key);
    return after ?? list.slice(0, Math.max(index, 0)).find((i) => i.group === "pending" && i.key !== item.key) ?? null;
  }

  async function decide(kind) {
    if (savingRef.current) return;
    const text = remarks.trim();
    if (kind === "decline" && !text) {
      setRemarksError(planting ? "Give the farmer a reason for rejecting this submission." : "Give the farmer a reason for returning the report.");
      remarksRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(kind);
    setRemarksError("");
    const goTo = nextPending();
    try {
      const updated = planting
        ? toItem.planting(kind === "approve" ? await approveSubmission(item.id, text) : await rejectSubmission(item.id, text))
        : toItem.harvest(await reviewHarvestReport(item.id, kind === "approve" ? "approved" : "rejected", text));
      onChanged(updated);
      onToast({ tone: "success", message: `${planting ? "Submission" : "Harvest report"} ${(kind === "approve" ? words.approved : words.declined).toLowerCase()}. The farmer was notified.` });
      if (goTo) onOpen(goTo);
      else onBack();
    } catch (err) {
      onToast({ tone: "error", message: friendlyError(err, "Couldn't save this decision. Please try again.") });
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  async function remove() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving("remove");
    const goTo = next ?? prev;
    try {
      await removeHarvestReport(item.id);
      setConfirmRemove(false);
      onRemoved(item);
      onToast({ tone: "success", message: "Harvest report removed." });
      if (goTo) onOpen(goTo);
      else onBack();
    } catch (err) {
      setConfirmRemove(false);
      onToast({ tone: "error", message: friendlyError(err, "Couldn't remove this harvest report. Please try again.") });
    } finally {
      savingRef.current = false;
      setSaving(null);
    }
  }

  const details = planting ? plantingRows(raw, lat, lng) : harvestRows(raw);
  const decided = !pending;

  return (
    <div className="agri-card agri-fill-card agri-vinbox agri-vi">
      <div className="agri-vi-topbar">
        <button type="button" className="agri-link-btn agri-vi-back" onClick={onBack}><ArrowLeft size={15} /> Back to validation</button>
        <div className="agri-vi-nav">
          {index >= 0 && <span className="agri-muted">{index + 1} of {list.length}</span>}
          <button type="button" className="agri-icon-btn" aria-label="Previous submission" disabled={!prev} onClick={() => prev && onOpen(prev)}><ChevronLeft size={16} /></button>
          <button type="button" className="agri-icon-btn" aria-label="Next submission" disabled={!next} onClick={() => next && onOpen(next)}><ChevronRight size={16} /></button>
          <RowActionsMenu
            label="More actions"
            actions={[
              canEdit && { key: "edit", label: "Edit", icon: Pencil, onClick: () => setEditing(true) },
              canRemove && { key: "remove", label: "Remove", icon: Trash2, danger: true, onClick: () => setConfirmRemove(true) },
            ]}
          />
        </div>
      </div>

      <div className="agri-vi-header">
        <FarmerAvatar url={item.avatarUrl} firstName={item.firstName} lastName={item.lastName} size={44} />
        <div className="agri-vi-who">
          <div className="agri-vi-name">
            <span>{item.farmerName}</span>
            <KindTag kind={item.kind} />
          </div>
          <div className="agri-muted agri-vi-meta">
            RSBSA {item.rsbsaNo || "—"} · Barangay {item.barangay || "—"} · Farm size {formatHectares(item.farmSize)}
          </div>
          <div className="agri-muted agri-vi-meta">Submitted {formatDate(item.date)} by {item.submittedBy} ({item.submittedRole})</div>
        </div>
        <Pill status={item.status} />
      </div>

      <div className="agri-vi-body">
        <div className="agri-vi-left">
          <div className="agri-vi-grid">
            {details.map(([label, value, wide]) => (
              <div key={label} className={wide ? "wide" : undefined}>
                <div className="agri-detail-label">{label}</div>
                <div className="agri-vi-value">{value ?? <span className="agri-muted">—</span>}</div>
              </div>
            ))}
          </div>
          <div className="agri-detail-section-title" style={{ marginTop: 14 }}>Timeline</div>
          <ol className="agri-timeline">
            <li className="agri-timeline-step done">
              <span className="agri-timeline-dot" aria-hidden="true" />
              <div className="agri-timeline-title">Submitted</div>
              <div className="agri-timeline-meta">by {item.submittedBy} ({item.submittedRole}) · {formatDateTime(item.date)}</div>
            </li>
            {!planting && raw.resubmittedAt && (
              <li className="agri-timeline-step done">
                <span className="agri-timeline-dot" aria-hidden="true" />
                <div className="agri-timeline-title">Corrected and resubmitted</div>
                <div className="agri-timeline-meta">{formatDateTime(raw.resubmittedAt)}</div>
                {raw.reviewRemarks && <div className="agri-timeline-remarks">Rejected earlier: “{raw.reviewRemarks}”</div>}
              </li>
            )}
            {pending ? (
              <li className="agri-timeline-step waiting">
                <span className="agri-timeline-dot" aria-hidden="true" />
                <div className="agri-timeline-title">Waiting for the MAO Admin to {words.waiting}</div>
              </li>
            ) : (
              <li className={`agri-timeline-step ${item.group === "rejected" ? "rejected" : "done"}`}>
                <span className="agri-timeline-dot" aria-hidden="true" />
                <div className="agri-timeline-title">{item.status}</div>
                <div className="agri-timeline-meta">by {reviewerOf(item)} · {reviewedAtOf(item) ? formatDateTime(reviewedAtOf(item)) : "date not recorded"}</div>
                {remarksOf(item) && <div className="agri-timeline-remarks">“{remarksOf(item)}”</div>}
              </li>
            )}
          </ol>
        </div>

        <div className="agri-vi-right">
          {photoPath ? (
            photoUrl ? (
              <button type="button" className="agri-vi-photo" onClick={() => setLightbox(true)} aria-label="Enlarge photo">
                <img src={photoUrl} alt={planting ? "Proof of planting" : "Harvest photo"} />
              </button>
            ) : (
              <div className="agri-vi-photo agri-vi-photo-empty"><ImageIcon size={28} color="var(--agri-icon-faint)" /></div>
            )
          ) : (
            <div className="agri-vi-photo agri-vi-photo-empty"><ImageIcon size={24} color="var(--agri-icon-faint)" /><span className="agri-muted">No photo attached</span></div>
          )}
          {lat != null && lng != null ? (
            <>
              <iframe title="Location" className="agri-vi-map" src={`https://www.google.com/maps?q=${lat},${lng}&z=15&output=embed`} loading="lazy" />
              <div className="agri-muted agri-vi-meta">
                {lat.toFixed(6)}, {lng.toFixed(6)}
                {km != null && <> · ~{km.toFixed(1)} km from Barangay {farmerBarangay.name}</>}
                {km > 5 && <span style={{ color: "var(--agri-orange-text)", fontWeight: 600 }}> — far from the barangay, worth a closer look</span>}
              </div>
            </>
          ) : (
            <div className="agri-vi-map agri-vi-photo-empty"><span className="agri-muted">No GPS location recorded</span></div>
          )}
        </div>
      </div>

      <div className="agri-vi-actions">
        {canReview ? (
          <>
            <div className="agri-vi-remarks">
              <label className="visually-hidden" htmlFor="vi-remarks">Remarks for the farmer (required to {words.decline.toLowerCase()})</label>
              <input
                id="vi-remarks"
                ref={remarksRef}
                className={`form-control${remarksError ? " is-invalid" : ""}`}
                maxLength={MAX_REMARKS}
                placeholder={`Remarks for the farmer (required to ${words.decline.toLowerCase()})`}
                value={remarks}
                onChange={(e) => { setRemarks(e.target.value); setRemarksError(""); }}
                disabled={!!saving}
              />
              {remarksError && <div className="invalid-feedback d-block">{remarksError}</div>}
            </div>
            <button type="button" className="btn btn-outline-danger d-flex align-items-center gap-2" onClick={() => decide("decline")} disabled={!!saving}>
              <XCircle size={15} /> {saving === "decline" ? "Rejecting…" : words.decline}
            </button>
            <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => decide("approve")} disabled={!!saving}>
              <CheckCircle2 size={15} /> {saving === "approve" ? "Approving…" : words.approve}
            </button>
          </>
        ) : decided ? (
          <div className={`agri-vi-decision ${item.group}`}>
            {item.group === "approved" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <div>
              <strong>{item.status}</strong> by {reviewerOf(item)}{reviewedAtOf(item) ? ` on ${formatDateTime(reviewedAtOf(item))}` : ""}
              {remarksOf(item) && <div className="agri-vi-decision-remarks">Remarks: {remarksOf(item)}</div>}
            </div>
          </div>
        ) : (
          <div className="agri-vi-decision waiting">
            <ShieldAlert size={16} />
            <div>Waiting for the MAO Admin to {words.waiting}. {planting ? "Only the MAO Admin validates proof of planting." : "Only the MAO Admin verifies harvest reports."}</div>
          </div>
        )}
      </div>

      {editing && (
        <HarvestReportModal
          report={raw}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            onChanged(toItem.harvest(saved));
            onToast({ tone: "success", message: raw.statusKey === "rejected" ? "Harvest report resubmitted to the MAO." : "Harvest report updated." });
          }}
        />
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove this harvest report?"
          message={`${item.farmerName}'s ${raw.harvestMonth} harvest report (${formatKg(raw.yieldKg)}) will be removed from the list and reports. The record is kept in the Activity Log.`}
          confirmLabel="Remove"
          busy={saving === "remove"}
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
      {lightbox && photoUrl && (
        <div className="agri-lightbox" onClick={() => setLightbox(false)}>
          <button type="button" className="agri-icon-btn" aria-label="Close photo" style={{ position: "absolute", top: 20, right: 20, background: "var(--agri-card)" }} onClick={() => setLightbox(false)}>
            <X size={16} />
          </button>
          <img src={photoUrl} alt={planting ? "Proof of planting" : "Harvest photo"} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function plantingRows(s, lat, lng) {
  const d = plantingDetails(s);
  return [
    ["Crop", d.crop || null],
    ["Area Planted", d.areaPlanted != null ? formatHectares(d.areaPlanted) : null],
    ["Planting Date", d.plantingDate],
    ["Photo Taken", s.capturedAt ? formatDateTime(s.capturedAt) : null],
    ["GPS Coordinates", lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}${s.gpsAccuracyMeters != null ? ` (±${Math.round(s.gpsAccuracyMeters)} m)` : ""}` : null, true],
    ["Farmer's Remarks", d.farmerRemarks || null, true],
  ];
}

function harvestRows(h) {
  return [
    ["Crop", h.crop || null],
    ["Harvest Date", formatDate(h.harvestDate)],
    ["Area Harvested", formatHectares(h.areaHa)],
    ["Harvest", formatKg(h.yieldKg)],
    ["Yield", h.yieldPerHa != null ? `${fmt(h.yieldPerHa)} kg/ha` : null],
    [h.filedByStaff ? "Remarks" : "Farmer's Remarks", h.remarks || null, true],
  ];
}

const reviewerOf = (i) => (i.kind === "planting" ? i.raw.reviewedBy ?? "the MAO Admin" : i.raw.reviewerName);
const reviewedAtOf = (i) => i.raw.reviewedAt;
// Planting: once reviewed, the note on the submission is the reviewer's.
const remarksOf = (i) => (i.kind === "planting" ? (i.group === "pending" ? "" : i.raw.remarks) : i.raw.reviewRemarks);
