import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImagePlus, Pin, X } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import DateInput from "../ui/DateInput.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import maoSeal from "../../assets/mao-seal.png";
import {
  AUDIENCES,
  IMAGE_TYPES,
  MAX_BODY,
  MAX_DETAILS,
  MAX_TITLE,
  composeBody,
  createAnnouncement,
  getAnnouncementImageUrl,
  updateAnnouncement,
  validateImageFile,
} from "../../lib/api/announcements.js";
import { friendlyError } from "../../lib/friendlyError.js";

const Req = () => <span style={{ color: "var(--agri-red)" }}>*</span>;
const Opt = () => <span className="agri-muted agri-post-optional">(optional)</span>;

// "Create post" (and "Edit post"): who it's for, the title, date and time,
// venue, details, then photo and pin. Shared by the Dashboard's "Post
// Announcement" and the Announcements page. `announcement` present = edit.
export default function AnnouncementModal({ announcement, onClose, onSaved }) {
  const editing = !!announcement;
  const [initial] = useState(() => ({
    audience: announcement?.audience ?? "farmers",
    title: announcement?.title ?? "",
    date: announcement?.date ?? "",
    time: announcement?.time ?? "",
    venue: announcement?.venue ?? "",
    details: announcement?.details ?? "",
    isPinned: announcement?.isPinned ?? false,
  }));
  const [audience, setAudience] = useState(initial.audience);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [venue, setVenue] = useState(initial.venue);
  const [details, setDetails] = useState(initial.details);
  const [isPinned, setIsPinned] = useState(initial.isPinned);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [currentImage, setCurrentImage] = useState(null); // signed URL of the saved photo
  const [removeCurrentImage, setRemoveCurrentImage] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textRef = useRef(null);
  const fileRef = useRef(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (announcement?.imagePath) getAnnouncementImageUrl(announcement.imagePath).then(setCurrentImage).catch(() => {});
  }, [announcement?.imagePath]);
  useEffect(() => () => imagePreview && URL.revokeObjectURL(imagePreview), [imagePreview]);

  // The details box grows with the text.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [details]);

  const hasSavedPhoto = editing && !!announcement.imagePath && !removeCurrentImage;
  const hasPhoto = !!imageFile || hasSavedPhoto;
  const titleTooLong = title.length > MAX_TITLE;
  const detailsTooLong = details.length > MAX_DETAILS;
  // Something to lose if the window closes.
  const dirty =
    audience !== initial.audience || title !== initial.title || date !== initial.date || time !== initial.time || venue !== initial.venue
    || details !== initial.details || isPinned !== initial.isPinned || !!imageFile || removeCurrentImage;

  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }
  useEscapeToClose(!confirmDiscard, requestClose);

  const clear = (key) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  async function choosePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = await validateImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function removePhoto() {
    if (imageFile) {
      URL.revokeObjectURL(imagePreview);
      setImageFile(null);
      setImagePreview(null);
    } else {
      setRemoveCurrentImage(true);
    }
  }

  function validate() {
    const next = {};
    if (!title.trim()) next.title = "Enter a title.";
    else if (titleTooLong) next.title = `Keep the title to ${MAX_TITLE} characters or fewer.`;
    if (detailsTooLong) next.details = `Keep the details to ${MAX_DETAILS.toLocaleString()} characters or fewer.`;
    else if (composeBody({ title, details, date, time, venue }).length > MAX_BODY) next.details = "This post is too long. Shorten the details.";
    return next;
  }

  async function post() {
    if (saving || savingRef.current) return;
    const problems = validate();
    setErrors(problems);
    if (Object.values(problems).some(Boolean)) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const fields = { title, date, time, venue, details, audience, isPinned };
      const saved = editing
        ? await updateAnnouncement(announcement.id, fields, { imageFile, removeCurrentImage, currentImagePath: announcement.imagePath })
        : await createAnnouncement(fields, imageFile);
      onSaved(saved, { editing });
    } catch (err) {
      setError(friendlyError(err, "Couldn't post this. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const photoSrc = imagePreview ?? (hasSavedPhoto ? currentImage : null);

  return (
    <>
      <div className="agri-modal-backdrop" onClick={requestClose}>
        <div
          className="agri-card agri-modal agri-post-modal"
          style={{ "--agri-modal-width": "580px" }}
          role="dialog"
          aria-label={editing ? "Edit post" : "Create post"}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="agri-modal-header">
            <div className="agri-modal-title">{editing ? "Edit post" : "Create post"}</div>
            <button type="button" className="agri-icon-btn" aria-label="Close" onClick={requestClose}><X size={16} /></button>
          </div>

          <div className="agri-modal-body">
            <div className="agri-post-author">
              <img src={maoSeal} alt="" className="agri-post-avatar" />
              <div className="agri-post-author-name">MAO Labangan</div>
              <label className="agri-post-audience">
                <span className="agri-muted">Post to</span>
                <select className="form-select form-select-sm" value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Post to" disabled={saving}>
                  {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </label>
            </div>

            <div className="agri-post-field">
              <div className="agri-post-label-row">
                <label className="agri-form-label" htmlFor="post-title">Title <Req /></label>
                <span className={`agri-post-count${titleTooLong ? " over" : ""}`}>{title.length}/{MAX_TITLE}</span>
              </div>
              <input
                id="post-title"
                className={`form-control${errors.title ? " is-invalid" : ""}`}
                value={title}
                placeholder="e.g. RCEF seed distribution on Friday"
                onChange={(e) => {
                  setTitle(e.target.value.replace(/[\r\n]+/g, " "));
                  clear("title");
                }}
                disabled={saving}
                autoFocus
              />
              {errors.title && <div className="agri-post-field-error" role="alert">{errors.title}</div>}
            </div>

            <div className="row g-3 agri-post-field">
              <div className="col-6">
                <label className="agri-form-label" htmlFor="post-date">Date <Opt /></label>
                <DateInput id="post-date" value={date} onChange={setDate} disabled={saving} aria-label="Date" />
              </div>
              <div className="col-6">
                <label className="agri-form-label" htmlFor="post-time">Time <Opt /></label>
                <input id="post-time" type="time" className="form-control" value={time} onChange={(e) => setTime(e.target.value)} disabled={saving} />
              </div>
            </div>

            <div className="agri-post-field">
              <label className="agri-form-label" htmlFor="post-venue">Venue <Opt /></label>
              <input id="post-venue" className="form-control" value={venue} placeholder="e.g. Langapud Barangay Hall" maxLength={150} onChange={(e) => setVenue(e.target.value.replace(/[\r\n]+/g, " "))} disabled={saving} />
            </div>

            <div className="agri-post-field">
              <div className="agri-post-label-row">
                <label className="agri-form-label" htmlFor="post-details">Details <Opt /></label>
                <span className={`agri-post-count${detailsTooLong ? " over" : ""}`} aria-live="polite">{details.length.toLocaleString()}/{MAX_DETAILS.toLocaleString()}</span>
              </div>
              <textarea
                id="post-details"
                ref={textRef}
                className={`form-control agri-post-text${errors.details ? " is-invalid" : ""}`}
                rows={4}
                placeholder="What farmers need to know: what to bring, who can join, requirements…"
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value);
                  clear("details");
                }}
                disabled={saving}
              />
              {errors.details && <div className="agri-post-field-error" role="alert">{errors.details}</div>}
            </div>

            {photoSrc ? (
              <div className="agri-post-photo">
                <img src={photoSrc} alt="Photo for this post" />
                <button type="button" className="agri-post-photo-remove" aria-label="Remove photo" onClick={removePhoto} disabled={saving}>
                  <X size={16} />
                </button>
              </div>
            ) : hasSavedPhoto ? (
              <div className="agri-post-photo agri-post-photo-loading" aria-label="Loading photo" />
            ) : null}

            {error && <div className="agri-pill red agri-post-error" role="alert">{error}</div>}

            <div className="agri-post-add">
              <span>Add to your post</span>
              <div className="agri-post-add-buttons">
                <button type="button" className="agri-post-add-btn" onClick={() => fileRef.current?.click()} disabled={saving} aria-label={hasPhoto ? "Change photo" : "Add photo"}>
                  <ImagePlus size={16} /> Photo
                </button>
                <button
                  type="button"
                  className={`agri-post-add-btn${isPinned ? " active" : ""}`}
                  aria-pressed={isPinned}
                  onClick={() => setIsPinned((v) => !v)}
                  disabled={saving}
                  title={isPinned ? "Pinned to the top" : "Pin to the top"}
                >
                  <Pin size={16} /> {isPinned ? "Pinned" : "Pin"}
                </button>
              </div>
              <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={choosePhoto} aria-label="Choose a photo" />
            </div>
          </div>

          <div className="agri-modal-footer">
            <button type="button" className="btn btn-agri-primary w-100" disabled={saving} onClick={post}>
              {saving ? (editing ? "Saving…" : "Posting…") : editing ? "Save" : "Post"}
            </button>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard this post?"
          message={editing ? "Your changes won't be saved." : "What you've written won't be posted."}
          confirmLabel="Discard"
          onConfirm={onClose}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}
