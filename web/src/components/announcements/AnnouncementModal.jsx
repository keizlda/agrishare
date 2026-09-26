import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import {
  AUDIENCES,
  CATEGORIES,
  MAX_BODY,
  MAX_TITLE,
  createAnnouncement,
  getAnnouncementImageUrl,
  updateAnnouncement,
  validateImageFile,
} from "../../lib/api/announcements.js";

// YYYY-MM-DD in local time (what <input type="date"> speaks).
function toDateInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// An expiry date means "through the end of that day".
function endOfDayIso(dateStr) {
  return dateStr ? new Date(`${dateStr}T23:59:59`).toISOString() : null;
}

// Shared by the dashboard's "Post Announcement" quick action (create) and the
// Announcements page (create + edit). `announcement` present = edit mode.
export default function AnnouncementModal({ announcement, onClose, onSaved }) {
  const editing = !!announcement;
  const isPublished = editing && announcement.status === "Published";

  const [form, setForm] = useState(() => ({
    title: announcement?.title ?? "",
    body: announcement?.body ?? "",
    category: announcement?.category ?? CATEGORIES[0],
    audience: announcement?.audience ?? AUDIENCES[0],
    isPinned: announcement?.isPinned ?? false,
    expiresOn: toDateInput(announcement?.expiresAt),
  }));
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [removeCurrentImage, setRemoveCurrentImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(null); // null | "Draft" | "Published"
  const fileRef = useRef(null);

  useEscapeToClose(true, () => !saving && onClose());

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

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
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
    if (!form.body.trim()) next.body = "Body is required.";
    else if (form.body.length > MAX_BODY) next.body = `Body must be ${MAX_BODY} characters or fewer.`;
    if (form.expiresOn && new Date(`${form.expiresOn}T23:59:59`) <= new Date()) {
      next.expiresOn = "Expiry date must be in the future.";
    }
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
      const fields = { ...form, expiresAt: endOfDayIso(form.expiresOn), status };
      const saved = editing
        ? await updateAnnouncement(announcement.id, fields, {
            imageFile,
            removeCurrentImage,
            currentImagePath: announcement.imagePath,
          })
        : await createAnnouncement(fields, imageFile);
      onSaved(saved, { editing, status, published: status === "Published" && (!editing || announcement.status === "Draft") });
    } catch (err) {
      setErrors({ form: err.message || "Couldn't save the announcement. Please try again." });
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

        <label className="agri-form-label" htmlFor="ann-body">Body <span style={{ color: "var(--agri-red)" }}>*</span></label>
        <textarea
          id="ann-body"
          className={`form-control${errors.body ? " is-invalid" : ""}`}
          rows={5}
          value={form.body}
          maxLength={MAX_BODY}
          placeholder="Write the announcement farmers will read"
          onChange={(e) => update("body", e.target.value)}
          disabled={busy}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "var(--agri-red)", fontSize: "0.78rem" }}>{errors.body}</div>
          <div className="agri-muted" style={{ fontSize: "0.72rem" }}>{form.body.length}/{MAX_BODY}</div>
        </div>

        <div className="row g-3 mb-3">
          <div className="col-12 col-sm-6">
            <label className="agri-form-label" htmlFor="ann-category">Category</label>
            <select id="ann-category" className="form-select" value={form.category} onChange={(e) => update("category", e.target.value)} disabled={busy}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-12 col-sm-6">
            <label className="agri-form-label" htmlFor="ann-audience">Target Audience</label>
            <select id="ann-audience" className="form-select" value={form.audience} onChange={(e) => update("audience", e.target.value)} disabled={busy}>
              {AUDIENCES.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
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

        <div className="row g-3 mt-1 mb-3 align-items-end">
          <div className="col-12 col-sm-6">
            <label className="agri-form-label" htmlFor="ann-expiry">Expires on (optional)</label>
            <input
              id="ann-expiry"
              type="date"
              className={`form-control${errors.expiresOn ? " is-invalid" : ""}`}
              min={toDateInput(new Date().toISOString())}
              value={form.expiresOn}
              onChange={(e) => update("expiresOn", e.target.value)}
              disabled={busy}
            />
            {errors.expiresOn && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginTop: 4 }}>{errors.expiresOn}</div>}
          </div>
          <div className="col-12 col-sm-6">
            <div className="form-check form-switch mb-2">
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
          </div>
        </div>

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
