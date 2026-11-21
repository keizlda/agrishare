import { useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import DateInput from "../ui/DateInput.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import {
  ASSOCIATION_TYPES,
  ATTACHMENT_TYPES,
  ITEM_SUGGESTIONS,
  LIMITS,
  createAssociationRequest,
  updateAssociationRequest,
  validateAttachment,
} from "../../lib/api/associationRequests.js";
import { todayIso } from "../../lib/dates.js";
import { friendlyError } from "../../lib/friendlyError.js";

const EMPTY = { type: "machinery", title: "", item: "", quantity: "", estimatedBeneficiaries: "", preferredDate: "", description: "" };

function formFor(request) {
  if (!request) return EMPTY;
  return {
    type: request.type,
    title: request.title,
    item: request.item ?? "",
    quantity: request.quantity == null ? "" : String(request.quantity),
    estimatedBeneficiaries: request.estimatedBeneficiaries == null ? "" : String(request.estimatedBeneficiaries),
    preferredDate: request.preferredDate ?? "",
    description: request.description,
  };
}

const wholeNumber = (text) => /^\d+$/.test(text.trim());
// Two years from today, "YYYY-MM-DD" (the database allows no later).
const latestDate = () => {
  const [y, m, d] = todayIso().split("-");
  return `${Number(y) + 2}-${m}-${d}`;
};
const fileSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// The same rules the database checks, as plain messages per field.
function validate(form, dateTyped) {
  const e = {};
  const title = form.title.trim();
  if (title.length < 3) e.title = "Enter a title (at least 3 characters).";
  else if (title.length > LIMITS.title) e.title = `Keep the title to ${LIMITS.title} characters or fewer.`;
  if (form.item.trim().length > LIMITS.item) e.item = `Keep the item to ${LIMITS.item} characters or fewer.`;
  if (form.quantity.trim() && (!wholeNumber(form.quantity) || Number(form.quantity) < 1 || Number(form.quantity) > LIMITS.quantity)) {
    e.quantity = `Enter a whole number from 1 to ${LIMITS.quantity.toLocaleString()}.`;
  }
  if (form.estimatedBeneficiaries.trim() && (!wholeNumber(form.estimatedBeneficiaries) || Number(form.estimatedBeneficiaries) < 1 || Number(form.estimatedBeneficiaries) > LIMITS.beneficiaries)) {
    e.estimatedBeneficiaries = `Enter a whole number from 1 to ${LIMITS.beneficiaries.toLocaleString()}.`;
  }
  if (dateTyped && !form.preferredDate) e.preferredDate = "Enter the date as MM/DD/YYYY.";
  else if (form.preferredDate && form.preferredDate < todayIso()) e.preferredDate = "Choose a preferred date from today onward.";
  else if (form.preferredDate && form.preferredDate > latestDate()) e.preferredDate = "Choose a preferred date within the next 2 years.";
  const description = form.description.trim();
  if (description.length < 10) e.description = "Describe the request and why it's needed (at least 10 characters).";
  else if (description.length > LIMITS.description) e.description = `Keep the description to ${LIMITS.description.toLocaleString()} characters or fewer.`;
  return e;
}

// New / Edit Association Request (Farmers' Association President). Editing
// is only offered while the request is Pending (the database allows nothing
// else).
export default function AssociationRequestModal({ request, onClose, onSaved }) {
  const editing = !!request;
  const [form, setForm] = useState(() => formFor(request));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [file, setFile] = useState(null);
  const [clearAttachment, setClearAttachment] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const fileRef = useRef(null);

  useEscapeToClose(!saving, onClose);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
  }

  async function pickFile(e) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const problem = await validateAttachment(picked);
    setErrors((x) => ({ ...x, attachment: problem ?? undefined }));
    if (!problem) {
      setFile(picked);
      setClearAttachment(false);
    }
  }

  const existingAttachment = editing && request.attachmentPath && !clearAttachment ? request.attachmentName || "Attachment" : null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (savingRef.current) return;
    // A half-typed date reads as "" — the field itself knows it's incomplete.
    const dateTyped = document.getElementById("assoc-preferred-date")?.value?.trim().length > 0;
    const found = validate(form, dateTyped);
    setErrors(found);
    setFormError("");
    if (Object.keys(found).length > 0) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = editing
        ? await updateAssociationRequest(request, form, { file, clearAttachment })
        : await createAssociationRequest(form, file);
      onSaved(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this request. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const fieldError = (key) => errors[key] && <div className="invalid-feedback d-block">{errors[key]}</div>;

  return (
    <div className="agri-modal-backdrop" onClick={saving ? undefined : onClose}>
      <form
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "560px" }}
        role="dialog"
        aria-label={editing ? "Edit Association Request" : "New Association Request"}
        onSubmit={handleSubmit}
        noValidate
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">{editing ? "Edit Association Request" : "New Association Request"}</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={saving}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {formError && (
            <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{formError}</div>
          )}
          <div className="agri-muted" style={{ fontSize: "0.78rem", marginBottom: 14 }}>
            Ask the MAO for machinery, a project or other support for the association. You can change or cancel it while it's Pending.
          </div>

          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-5">
              <label className="agri-form-label" htmlFor="assoc-type">Type <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <select id="assoc-type" className="form-select" value={form.type} onChange={(e) => update("type", e.target.value)} disabled={saving}>
                {ASSOCIATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="col-12 col-sm-7">
              <label className="agri-form-label" htmlFor="assoc-item">Item</label>
              <input
                id="assoc-item"
                className={`form-control${errors.item ? " is-invalid" : ""}`}
                list="assoc-item-suggestions"
                maxLength={LIMITS.item}
                placeholder="e.g. Hand tractor"
                value={form.item}
                onChange={(e) => update("item", e.target.value)}
                disabled={saving}
              />
              <datalist id="assoc-item-suggestions">
                {ITEM_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
              {fieldError("item")}
            </div>
          </div>

          <label className="agri-form-label" htmlFor="assoc-title">Title <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <input
            id="assoc-title"
            className={`form-control${errors.title ? " is-invalid" : ""}`}
            maxLength={LIMITS.title}
            placeholder="e.g. Hand tractor for Purok 3 rice farmers"
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            disabled={saving}
            autoFocus
          />
          {fieldError("title")}

          <div className="row g-3 mt-0 mb-3">
            <div className="col-6 col-sm-4">
              <label className="agri-form-label" htmlFor="assoc-quantity">Quantity</label>
              <input id="assoc-quantity" inputMode="numeric" className={`form-control${errors.quantity ? " is-invalid" : ""}`} placeholder="e.g. 1" value={form.quantity} onChange={(e) => update("quantity", e.target.value)} disabled={saving} />
              {fieldError("quantity")}
            </div>
            <div className="col-6 col-sm-4">
              <label className="agri-form-label" htmlFor="assoc-beneficiaries">Est. Beneficiaries</label>
              <input id="assoc-beneficiaries" inputMode="numeric" className={`form-control${errors.estimatedBeneficiaries ? " is-invalid" : ""}`} placeholder="Farmers" value={form.estimatedBeneficiaries} onChange={(e) => update("estimatedBeneficiaries", e.target.value)} disabled={saving} />
              {fieldError("estimatedBeneficiaries")}
            </div>
            <div className="col-12 col-sm-4">
              <label className="agri-form-label" htmlFor="assoc-preferred-date">Preferred Date</label>
              <DateInput id="assoc-preferred-date" value={form.preferredDate} min={todayIso()} max={latestDate()} onChange={(v) => update("preferredDate", v)} invalid={!!errors.preferredDate} disabled={saving} aria-label="Preferred date" />
              {fieldError("preferredDate")}
            </div>
          </div>

          <label className="agri-form-label" htmlFor="assoc-description">Description / Justification <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <textarea
            id="assoc-description"
            className={`form-control${errors.description ? " is-invalid" : ""}`}
            rows={4}
            maxLength={LIMITS.description}
            placeholder="What is needed, who will benefit, and why"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            disabled={saving}
          />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div>{fieldError("description")}</div>
            <div className="agri-muted" style={{ fontSize: "0.72rem", flex: "none" }}>{form.description.length}/{LIMITS.description}</div>
          </div>

          <div className="agri-form-label" style={{ marginTop: 10 }}>Attachment (optional)</div>
          {file || existingAttachment ? (
            <div className="agri-attachment-chip">
              <FileText size={16} />
              <span className="agri-attachment-name">{file ? file.name : existingAttachment}</span>
              {file && <span className="agri-muted" style={{ fontSize: "0.72rem" }}>{fileSize(file.size)}</span>}
              <button
                type="button"
                className="agri-icon-btn"
                aria-label="Remove attachment"
                onClick={() => {
                  if (file) setFile(null);
                  else setClearAttachment(true);
                }}
                disabled={saving}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className="agri-ann-upload" onClick={() => fileRef.current?.click()} disabled={saving}>
              <Paperclip size={18} /> Attach a quotation, photo or letter
              <span className="agri-muted" style={{ fontSize: "0.72rem" }}>JPG, PNG, WebP or PDF, up to 5 MB</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept={ATTACHMENT_TYPES.join(",")} hidden onChange={pickFile} />
          {errors.attachment && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginTop: 4 }}>{errors.attachment}</div>}
        </div>

        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save Changes" : "Submit Request"}
          </button>
        </div>
      </form>
    </div>
  );
}
