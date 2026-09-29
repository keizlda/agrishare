import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import {
  RECIPIENTS,
  MAX_BODY,
  MAX_TITLE,
  createAnnouncement,
  getAnnouncementImageUrl,
  updateAnnouncement,
  validateImageFile,
} from "../../lib/api/announcements.js";
import { listDistributionBeneficiaries, listDistributions } from "../../lib/api/distributions.js";
import { listCommodities } from "../../lib/api/commodities.js";
import { friendlyError } from "../../lib/friendlyError.js";

const OTHER_ASSISTANCE = "Other (specify)";

// Shared by the dashboard's "Post Announcement" quick action (create) and the
// Announcements page (create + edit). `announcement` present = edit mode.
export default function AnnouncementModal({ announcement, onClose, onSaved }) {
  const editing = !!announcement;
  const isPublished = editing && announcement.status === "Published";

  const [form, setForm] = useState(() => ({
    title: announcement?.title ?? "",
    isGeneralNotice: announcement ? announcement.isGeneralNotice : false,
    linkedDistributionId: announcement?.linkedDistributionId ? String(announcement.linkedDistributionId) : "",
    distributionDate: announcement?.distributionDate ?? "",
    distributionTime: announcement?.distributionTime ?? "",
    venue: announcement?.venue ?? "",
    assistanceType: announcement?.assistanceType ?? "",
    assistanceTypeOther: "",
    requirements: announcement?.requirements ?? "",
    body: announcement?.body ?? "",
    recipients: announcement?.recipients ?? [RECIPIENTS[0]],
    isPinned: announcement?.isPinned ?? false,
  }));

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [removeCurrentImage, setRemoveCurrentImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(null); // null | "Draft" | "Published"
  const fileRef = useRef(null);

  const [distributions, setDistributions] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [linkedBeneficiaries, setLinkedBeneficiaries] = useState([]);
  const [loadingBeneficiaries, setLoadingBeneficiaries] = useState(false);

  useEscapeToClose(true, () => !saving && onClose());

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
    listCommodities()
      .then((rows) => setCommodities(rows.filter((c) => c.status === "Active")))
      .catch(() => {});
  }, []);

  // If the saved assistance type isn't one of the currently-active
  // commodities (deleted since, or originally freeform), fall back to
  // "Other" with the original text preserved instead of losing it.
  useEffect(() => {
    if (!announcement?.assistanceType || commodities.length === 0) return;
    if (!commodities.some((c) => c.name === announcement.assistanceType)) {
      setForm((f) =>
        f.assistanceType === announcement.assistanceType
          ? { ...f, assistanceType: OTHER_ASSISTANCE, assistanceTypeOther: announcement.assistanceType }
          : f,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodities]);

  // Existing image (edit mode) needs a signed URL; a newly picked file is
  // previewed from an object URL, revoked when replaced/unmounted.
  useEffect(() => {
    if (!imageFile) return undefined;
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const [existingUrl, setExistingUrl] = useState(null);
  useEffect(() => {
    if (!announcement?.imagePath) return;
    getAnnouncementImageUrl(announcement.imagePath).then(setExistingUrl).catch(() => {});
  }, [announcement?.imagePath]);

  // Read-only beneficiary preview once a distribution is linked.
  useEffect(() => {
    if (!form.linkedDistributionId) {
      setLinkedBeneficiaries([]);
      return undefined;
    }
    let cancelled = false;
    setLoadingBeneficiaries(true);
    listDistributionBeneficiaries(Number(form.linkedDistributionId))
      .then((rows) => {
        // Deleted farmers are left out of this preview (unlike the
        // Distributions detail panel, which keeps them for the historical
        // record) — an announcement is forward-looking, not a record of
        // what happened.
        if (!cancelled) setLinkedBeneficiaries(rows.filter((r) => !r.farmerDeleted));
      })
      .catch(() => {
        if (!cancelled) setLinkedBeneficiaries([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBeneficiaries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.linkedDistributionId]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
  }

  function toggleRecipient(recipient, checked) {
    update("recipients", checked ? [...form.recipients, recipient] : form.recipients.filter((r) => r !== recipient));
  }

  function pickLinkedDistribution(idStr) {
    const dist = distributions.find((d) => String(d.id) === idStr);
    setForm((f) => ({
      ...f,
      linkedDistributionId: idStr,
      distributionDate: dist ? dist.date : f.distributionDate,
      venue: dist ? dist.venue : f.venue,
      assistanceType:
        dist && commodities.some((c) => c.name === dist.items?.[0]?.name) ? dist.items[0].name : f.assistanceType,
    }));
  }

  function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      setErrors((er) => ({ ...er, image: problem }));
      return;
    }
    setErrors((er) => ({ ...er, image: undefined }));
    setImageFile(file);
    setRemoveCurrentImage(false);
  }

  function clearImage() {
    setImageFile(null);
    setImagePreview(null);
    if (announcement?.imagePath) setRemoveCurrentImage(true);
  }

  function validate() {
    const next = {};
    if (!form.title.trim()) next.title = "Title is required.";
    else if (form.title.length > MAX_TITLE) next.title = `Title must be ${MAX_TITLE} characters or fewer.`;

    if (form.isGeneralNotice) {
      if (!form.body.trim()) next.body = "Additional Details is required for a general notice.";
      else if (form.body.length > MAX_BODY) next.body = `Additional Details must be ${MAX_BODY} characters or fewer.`;
    } else {
      if (!form.distributionDate) next.distributionDate = "Distribution date is required.";
      if (!form.distributionTime) next.distributionTime = "Distribution time is required.";
      if (!form.venue.trim()) next.venue = "Venue is required.";
      if (!form.assistanceType || (form.assistanceType === OTHER_ASSISTANCE && !form.assistanceTypeOther.trim())) {
        next.assistanceType = "Type of assistance is required.";
      }
      if (!form.requirements.trim()) next.requirements = "Requirements needed is required.";
      if (form.body.length > MAX_BODY) next.body = `Additional Details must be ${MAX_BODY} characters or fewer.`;
    }

    if (form.recipients.length === 0) next.recipients = "Choose at least one recipient.";
    return next;
  }

  async function submit(status) {
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setSaving(status);
    setErrors({});
    try {
      const assistanceType = form.assistanceType === OTHER_ASSISTANCE ? form.assistanceTypeOther.trim() : form.assistanceType;
      const fields = {
        ...form,
        status,
        assistanceType,
        linkedDistributionId: form.linkedDistributionId || null,
      };
      const saved = editing
        ? await updateAnnouncement(announcement.id, fields, {
            imageFile,
            removeCurrentImage,
            currentImagePath: announcement.imagePath,
          })
        : await createAnnouncement(fields, imageFile);
      onSaved(saved, { editing, status, published: status === "Published" && (!editing || announcement.status === "Draft") });
    } catch (err) {
      setErrors({ form: friendlyError(err, "Couldn't save the announcement. Please try again.") });
      setSaving(null);
    }
  }

  const shownImage = imagePreview ?? (removeCurrentImage ? null : existingUrl);
  const busy = !!saving;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={() => !busy && onClose()}
    >
      <div
        className="agri-card"
        role="dialog"
        aria-label={editing ? "Edit announcement" : "Post announcement"}
        style={{ width: 560, maxWidth: "94vw", padding: 22, maxHeight: "92vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-panel-header">
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{editing ? "Edit Announcement" : "Post Announcement"}</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button>
        </div>

        {errors.form && (
          <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }} role="alert">{errors.form}</div>
        )}

        <label className="agri-form-label" htmlFor="ann-title">Title <span style={{ color: "var(--agri-red)" }}>*</span></label>
        <input
          id="ann-title"
          className={`form-control${errors.title ? " is-invalid" : ""}`}
          value={form.title}
          maxLength={MAX_TITLE}
          placeholder="e.g. RCEF seed distribution this Friday"
          onChange={(e) => update("title", e.target.value)}
          disabled={busy}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "var(--agri-red)", fontSize: "0.78rem" }}>{errors.title}</div>
          <div className="agri-muted" style={{ fontSize: "0.72rem" }}>{form.title.length}/{MAX_TITLE}</div>
        </div>

        <label className="agri-form-label" htmlFor="ann-linked-dist">Link to a Distribution (optional)</label>
        <select
          id="ann-linked-dist"
          className="form-select mb-3"
          value={form.linkedDistributionId}
          onChange={(e) => pickLinkedDistribution(e.target.value)}
          disabled={busy || form.isGeneralNotice}
        >
          <option value="">No linked distribution</option>
          {distributions.map((d) => (
            <option key={d.id} value={d.id}>{d.program} — {d.date}</option>
          ))}
        </select>

        <div className="form-check form-switch mb-3">
          <input
            id="ann-general"
            className="form-check-input"
            type="checkbox"
            role="switch"
            checked={form.isGeneralNotice}
            onChange={(e) => update("isGeneralNotice", e.target.checked)}
            disabled={busy}
          />
          <label className="form-check-label" htmlFor="ann-general" style={{ fontSize: "0.85rem" }}>
            General notice (not tied to a specific distribution)
          </label>
        </div>

        {!form.isGeneralNotice && (
          <>
            <div className="row g-3 mb-3">
              <div className="col-6">
                <label className="agri-form-label">Distribution Date <span style={{ color: "var(--agri-red)" }}>*</span></label>
                <input
                  type="date"
                  className={`form-control${errors.distributionDate ? " is-invalid" : ""}`}
                  value={form.distributionDate}
                  onChange={(e) => update("distributionDate", e.target.value)}
                  disabled={busy}
                />
                {errors.distributionDate && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem" }}>{errors.distributionDate}</div>}
              </div>
              <div className="col-6">
                <label className="agri-form-label">Distribution Time <span style={{ color: "var(--agri-red)" }}>*</span></label>
                <input
                  type="time"
                  className={`form-control${errors.distributionTime ? " is-invalid" : ""}`}
                  value={form.distributionTime}
                  onChange={(e) => update("distributionTime", e.target.value)}
                  disabled={busy}
                />
                {errors.distributionTime && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem" }}>{errors.distributionTime}</div>}
              </div>
            </div>

            <label className="agri-form-label">Venue <span style={{ color: "var(--agri-red)" }}>*</span></label>
            <input
              className={`form-control mb-3${errors.venue ? " is-invalid" : ""}`}
              value={form.venue}
              placeholder="e.g. Barangay Hall"
              onChange={(e) => update("venue", e.target.value)}
              disabled={busy}
            />
            {errors.venue && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginTop: -10, marginBottom: 10 }}>{errors.venue}</div>}

            <label className="agri-form-label">Type of Assistance <span style={{ color: "var(--agri-red)" }}>*</span></label>
            <select
              className="form-select mb-2"
              value={form.assistanceType}
              onChange={(e) => update("assistanceType", e.target.value)}
              disabled={busy}
            >
              <option value="">Select a type…</option>
              {commodities.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              <option value={OTHER_ASSISTANCE}>{OTHER_ASSISTANCE}</option>
            </select>
            {form.assistanceType === OTHER_ASSISTANCE && (
              <input
                className="form-control mb-2"
                placeholder="Specify the type of assistance"
                value={form.assistanceTypeOther}
                onChange={(e) => update("assistanceTypeOther", e.target.value)}
                disabled={busy}
              />
            )}
            {errors.assistanceType && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginBottom: 8 }}>{errors.assistanceType}</div>}
            <div className="mb-1" />

            <label className="agri-form-label">Requirements Needed <span style={{ color: "var(--agri-red)" }}>*</span></label>
            <textarea
              className={`form-control${errors.requirements ? " is-invalid" : ""}`}
              rows={2}
              value={form.requirements}
              placeholder="e.g. Valid RSBSA ID, barangay certification"
              onChange={(e) => update("requirements", e.target.value)}
              disabled={busy}
            />
            {errors.requirements && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem" }}>{errors.requirements}</div>}
            <div className="mb-3" />

            {form.linkedDistributionId && (
              <div style={{ marginBottom: 14 }}>
                <label className="agri-form-label">List of Beneficiaries (from linked distribution)</label>
                {loadingBeneficiaries ? (
                  <div className="agri-muted" style={{ fontSize: "0.78rem" }}>Loading…</div>
                ) : linkedBeneficiaries.length === 0 ? (
                  <div className="agri-muted" style={{ fontSize: "0.78rem" }}>No farmers tagged on that distribution yet.</div>
                ) : (
                  <div className="agri-beneficiary-table-wrap">
                    <table className="agri-table">
                      <tbody>
                        {linkedBeneficiaries.map((b) => (
                          <tr key={b.claimId}><td>{b.firstName} {b.lastName}</td><td>{b.rsbsaNo}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <label className="agri-form-label" htmlFor="ann-body">
          Additional Details {form.isGeneralNotice && <span style={{ color: "var(--agri-red)" }}>*</span>}
        </label>
        <textarea
          id="ann-body"
          className={`form-control${errors.body ? " is-invalid" : ""}`}
          rows={4}
          value={form.body}
          maxLength={MAX_BODY}
          placeholder="Anything else farmers should know"
          onChange={(e) => update("body", e.target.value)}
          disabled={busy}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "var(--agri-red)", fontSize: "0.78rem" }}>{errors.body}</div>
          <div className="agri-muted" style={{ fontSize: "0.72rem" }}>{form.body.length}/{MAX_BODY}</div>
        </div>

        <label className="agri-form-label">Image (optional)</label>
        {shownImage ? (
          <div className="agri-ann-image-preview">
            <img src={shownImage} alt="Announcement attachment preview" />
            <button type="button" className="agri-icon-btn" aria-label="Remove image" onClick={clearImage} disabled={busy}><X size={14} /></button>
          </div>
        ) : (
          <button type="button" className="agri-ann-upload" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImagePlus size={18} /> Add an image
            <span className="agri-muted" style={{ fontSize: "0.72rem" }}>PNG or JPG, up to 5 MB</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
        {errors.image && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginTop: 4 }}>{errors.image}</div>}

        <div className="form-check form-switch mt-3 mb-3">
          <input
            id="ann-pin"
            className="form-check-input"
            type="checkbox"
            role="switch"
            checked={form.isPinned}
            onChange={(e) => update("isPinned", e.target.checked)}
            disabled={busy}
          />
          <label className="form-check-label" htmlFor="ann-pin" style={{ fontSize: "0.85rem" }}>Pin to the top</label>
        </div>

        <div className="agri-form-label" style={{ marginBottom: 8 }}>Recipients <span style={{ color: "var(--agri-red)" }}>*</span></div>
        <div style={{ marginBottom: 4 }}>
          {RECIPIENTS.map((r) => (
            <div className="form-check" key={r}>
              <input
                id={`ann-recipient-${r}`}
                className="form-check-input"
                type="checkbox"
                checked={form.recipients.includes(r)}
                onChange={(e) => toggleRecipient(r, e.target.checked)}
                disabled={busy}
              />
              <label className="form-check-label" htmlFor={`ann-recipient-${r}`} style={{ fontSize: "0.85rem" }}>{r}</label>
            </div>
          ))}
        </div>
        {errors.recipients && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginBottom: 8 }}>{errors.recipients}</div>}
        <div className="mb-3" />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          {isPublished ? (
            <button type="button" className="btn btn-agri-primary" onClick={() => submit("Published")} disabled={busy}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-outline-secondary" onClick={() => submit("Draft")} disabled={busy}>
                {saving === "Draft" ? "Saving…" : "Save as Draft"}
              </button>
              <button type="button" className="btn btn-agri-primary" onClick={() => submit("Published")} disabled={busy}>
                {saving === "Published" ? "Publishing…" : "Publish"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
