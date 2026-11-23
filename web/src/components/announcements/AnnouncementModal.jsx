import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImagePlus, Pin, X } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import maoSeal from "../../assets/mao-seal.png";
import {
  AUDIENCES,
  IMAGE_TYPES,
  MAX_BODY,
  createAnnouncement,
  getAnnouncementImageUrl,
  updateAnnouncement,
  validateImageFile,
} from "../../lib/api/announcements.js";
import { friendlyError } from "../../lib/friendlyError.js";

const PLACEHOLDER =
  "What do you want to announce? Include the date, time, venue, type of assistance, and requirements if it's about a distribution.";

// "Create post" (and "Edit post"): one text box, an optional photo, Pin, and
// who it's for. Shared by the Dashboard's "Post Announcement" and the
// Announcements page. `announcement` present = edit.
export default function AnnouncementModal({ announcement, onClose, onSaved }) {
  const editing = !!announcement;
  const [body, setBody] = useState(announcement?.body ?? "");
  const [audience, setAudience] = useState(announcement?.audience ?? "farmers");
  const [isPinned, setIsPinned] = useState(announcement?.isPinned ?? false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [currentImage, setCurrentImage] = useState(null); // signed URL of the saved photo
  const [removeCurrentImage, setRemoveCurrentImage] = useState(false);
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

  // The text box grows with the text (6 lines to start).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [body]);
  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const hasSavedPhoto = editing && !!announcement.imagePath && !removeCurrentImage;
  const hasPhoto = !!imageFile || hasSavedPhoto;
  const tooLong = body.length > MAX_BODY;
  const canPost = (body.trim().length > 0 || hasPhoto) && !tooLong && !saving;
  // Something to lose if the window closes.
  const dirty = editing
    ? body !== announcement.body || audience !== announcement.audience || isPinned !== announcement.isPinned || !!imageFile || removeCurrentImage
    : body.trim().length > 0 || !!imageFile;

  function requestClose() {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }
  useEscapeToClose(!confirmDiscard, requestClose);

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

  async function post() {
    if (!canPost || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const fields = { body, audience, isPinned };
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
          style={{ "--agri-modal-width": "560px" }}
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

            <textarea
              ref={textRef}
              className={`form-control agri-post-text${tooLong ? " is-invalid" : ""}`}
              rows={6}
              placeholder={PLACEHOLDER}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Post text"
              disabled={saving}
            />
            <div className={`agri-post-count${tooLong ? " over" : ""}`} aria-live="polite">
              {body.length.toLocaleString()} / {MAX_BODY.toLocaleString()}
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
            <button type="button" className="btn btn-agri-primary w-100" disabled={!canPost} onClick={post}>
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
