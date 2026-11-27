import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Eye, ImagePlus, Pin, X } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import DateInput from "../ui/DateInput.jsx";
import BarangayPicker from "./BarangayPicker.jsx";
import FarmerTagInput from "../distributions/FarmerTagInput.jsx";
import { listDistributionBeneficiaries, listDistributions } from "../../lib/api/distributions.js";
import { formatDate } from "../../lib/dates.js";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import maoSeal from "../../assets/mao-seal.png";
import {
  IMAGE_TYPES,
  MAX_BODY,
  MAX_TITLE,
  audienceFrom,
  audienceParts,
  createAnnouncement,
  getAnnouncementImageUrl,
  updateAnnouncement,
  validateImageFile,
} from "../../lib/api/announcements.js";
import { listEntries } from "../../lib/api/lists.js";
import { friendlyError } from "../../lib/friendlyError.js";

const Req = () => <span style={{ color: "var(--agri-red)" }}>*</span>;
const Opt = () => <span className="agri-muted agri-post-optional">(optional)</span>;

// "Visible to farmers and Farmers' Association Presidents in 3 barangays";
// null until who and where are both chosen.
function visibleTo({ farmers, fa }, allBarangays, chosenNames) {
  const who = [farmers && "farmers", fa && "Farmers' Association Presidents"].filter(Boolean).join(" and ");
  if (!who) return null;
  if (allBarangays) return `Visible to ${who} in all barangays`;
  if (chosenNames.length === 0) return null;
  return `Visible to ${who} in ${chosenNames.length === 1 ? chosenNames[0] : `${chosenNames.length} barangays`}`;
}

// "Create post" (and "Edit post"), top to bottom: who can see it, which
// barangays, the title, date and time, venue, details, then photo and pin.
// Shared by the Dashboard's "Post Announcement" and the Announcements page.
// `announcement` present = edit. `barangays`: the list, when the caller
// already has it (otherwise it's loaded here).
// A distribution schedule post goes to that distribution's farmers: its
// tagged farmers (the default), every farmer of its barangay, or farmers
// chosen by name. The barangay's Farmers' Association President sees it too.
const TARGETS = [
  ["tagged", "Tagged farmers"],
  ["all", "All farmers of the barangay"],
  ["choose", "Choose farmers"],
];

export default function AnnouncementModal({ announcement, barangays: barangaysProp, onClose, onSaved }) {
  const editing = !!announcement;
  // "post" (a regular post) or "schedule" (a distribution's schedule).
  const [kind, setKind] = useState(announcement?.linkedDistributionId ? "schedule" : "post");
  const [distributions, setDistributions] = useState(null);
  const [eventId, setEventId] = useState(announcement?.linkedDistributionId ? String(announcement.linkedDistributionId) : "");
  const [tagged, setTagged] = useState(null); // the distribution's tagged farmers
  const [target, setTarget] = useState(announcement?.linkedDistributionId ? (announcement.targetFarmerIds ? "choose" : "all") : "tagged");
  const [chosen, setChosen] = useState([]); // [{ farmerId, firstName, lastName }]
  const targetSettled = useRef(!announcement?.linkedDistributionId);
  const [initial] = useState(() => ({
    who: editing ? audienceParts(announcement.audience) : { farmers: false, fa: false },
    allBarangays: editing ? announcement.allBarangays : true,
    barangayIds: editing ? announcement.barangayIds : [],
    title: announcement?.title ?? "",
    date: announcement?.date ?? "",
    time: announcement?.time ?? "",
    venue: announcement?.venue ?? "",
    body: announcement?.body ?? "",
    isPinned: announcement?.isPinned ?? false,
  }));
  const [who, setWho] = useState(initial.who);
  const [allBarangays, setAllBarangays] = useState(initial.allBarangays);
  const [barangayIds, setBarangayIds] = useState(initial.barangayIds);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [venue, setVenue] = useState(initial.venue);
  const [body, setBody] = useState(initial.body);
  const [isPinned, setIsPinned] = useState(initial.isPinned);
  const [loadedBarangays, setLoadedBarangays] = useState([]);
  const barangays = barangaysProp ?? loadedBarangays;
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
    if (!barangaysProp) listEntries("barangays").then(setLoadedBarangays).catch(() => setError("Couldn't load the barangays. Close this window and try again."));
  }, [barangaysProp]);
  useEffect(() => {
    if (announcement?.imagePath) getAnnouncementImageUrl(announcement.imagePath).then(setCurrentImage).catch(() => {});
  }, [announcement?.imagePath]);

  // Distribution schedule: the distributions to choose from (Ongoing ones,
  // plus the one this post already has), and the chosen one's farmers.
  useEffect(() => {
    if (kind !== "schedule" || distributions) return;
    listDistributions()
      .then((all) => setDistributions(all.filter((d) => d.status === "Ongoing" || String(d.id) === String(announcement?.linkedDistributionId ?? ""))))
      .catch(() => setError("Couldn't load the distributions. Close this window and try again."));
  }, [kind, distributions, announcement?.linkedDistributionId]);
  useEffect(() => {
    if (!eventId) {
      setTagged(null);
      return undefined;
    }
    let cancelled = false;
    setTagged(null);
    listDistributionBeneficiaries(eventId)
      .then((list) => {
        if (cancelled) return;
        const farmers = list.map((r) => ({ farmerId: r.farmerId, firstName: r.firstName, lastName: r.lastName }));
        setTagged(farmers);
        // Editing: the saved farmers — "Tagged farmers" when they're exactly
        // the distribution's tagged farmers.
        if (!targetSettled.current) {
          targetSettled.current = true;
          const ids = announcement.targetFarmerIds;
          if (ids) {
            const same = ids.length === farmers.length && farmers.every((f) => ids.includes(f.farmerId));
            setTarget(same ? "tagged" : "choose");
            setChosen(farmers.filter((f) => ids.includes(f.farmerId)).concat(ids.filter((id) => !farmers.some((f) => f.farmerId === id)).map((id) => ({ farmerId: id, firstName: "Farmer", lastName: `#${id}` }))));
          }
        }
      })
      .catch(() => !cancelled && setError("Couldn't load the distribution's farmers."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  const event = distributions?.find((d) => String(d.id) === eventId) ?? null;

  function chooseEvent(id) {
    setEventId(id);
    clear("event");
    const d = distributions.find((x) => String(x.id) === id);
    if (!d) return;
    // Filled in from the distribution (only what's still empty).
    if (!title.trim()) setTitle(`${d.program} — ${d.items?.[0]?.name ?? "distribution"}`.slice(0, MAX_TITLE));
    if (!date && d.date) setDate(d.date);
    if (!venue.trim() && d.venue) setVenue(d.venue);
    setChosen([]);
  }
  useEffect(() => () => imagePreview && URL.revokeObjectURL(imagePreview), [imagePreview]);

  // The details box grows with the text.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [body]);

  const hasSavedPhoto = editing && !!announcement.imagePath && !removeCurrentImage;
  const hasPhoto = !!imageFile || hasSavedPhoto;
  const chosenNames = barangayIds.map((id) => barangays.find((b) => b.id === id)?.name).filter(Boolean);
  const schedule = kind === "schedule";
  const scheduleFarmers = target === "tagged" ? tagged ?? [] : target === "choose" ? chosen : null;
  const summary = schedule
    ? event
      ? target === "all"
        ? `Visible to every farmer of Barangay ${event.barangay} and its Farmers' Association President`
        : `Visible to ${scheduleFarmers.length} ${scheduleFarmers.length === 1 ? "farmer" : "farmers"} of this distribution and the Farmers' Association President of Barangay ${event.barangay}`
      : null
    : visibleTo(who, allBarangays, chosenNames);
  const titleTooLong = title.length > MAX_TITLE;
  const bodyTooLong = body.length > MAX_BODY;
  const sameIds = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  // Something to lose if the window closes.
  const dirty =
    who.farmers !== initial.who.farmers || who.fa !== initial.who.fa || allBarangays !== initial.allBarangays || !sameIds(barangayIds, initial.barangayIds)
    || title !== initial.title || date !== initial.date || time !== initial.time || venue !== initial.venue || body !== initial.body
    || isPinned !== initial.isPinned || !!imageFile || removeCurrentImage
    || kind !== (announcement?.linkedDistributionId ? "schedule" : "post") || eventId !== (announcement?.linkedDistributionId ? String(announcement.linkedDistributionId) : "");

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
    if (schedule) {
      if (!eventId) next.event = "Choose the distribution.";
      else if (target === "tagged" && tagged && tagged.length === 0) next.target = "This distribution has no tagged farmers yet. Tag them first, or choose another option.";
      else if (target === "choose" && chosen.length === 0) next.target = "Choose at least one farmer.";
    } else {
      if (!who.farmers && !who.fa) next.audience = "Choose who can see this post.";
      if (!allBarangays && barangayIds.length === 0) next.barangays = "Choose at least one barangay.";
    }
    if (!title.trim()) next.title = "Enter a title.";
    else if (titleTooLong) next.title = `Keep the title to ${MAX_TITLE} characters or fewer.`;
    if (bodyTooLong) next.body = `Keep the details to ${MAX_BODY.toLocaleString()} characters or fewer.`;
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
      const fields = schedule
        ? {
            title, date, time, venue, body, isPinned,
            // The distribution's farmers and its barangay's president.
            audience: "everyone",
            allBarangays: false,
            barangayIds: event?.barangayId ? [Number(event.barangayId)] : [],
            linkedDistributionId: eventId,
            targetFarmerIds: target === "all" ? null : scheduleFarmers.map((f) => f.farmerId),
          }
        : { title, date, time, venue, body, audience: audienceFrom(who), allBarangays, barangayIds, isPinned, linkedDistributionId: null, targetFarmerIds: null };
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
  const toggleWho = (key) => {
    setWho((w) => ({ ...w, [key]: !w[key] }));
    clear("audience");
  };

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
            </div>

            <div className="agri-post-field">
              <div className="agri-form-label" id="post-kind">Type of post</div>
              <div className="agri-post-switch" role="radiogroup" aria-labelledby="post-kind">
                {[["post", "Announcement"], ["schedule", "Distribution schedule"]].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    className={kind === value ? "on" : ""}
                    onClick={() => {
                      setKind(value);
                      setErrors({});
                    }}
                    disabled={saving}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {schedule ? (
              <>
                <div className="agri-post-field">
                  <label className="agri-form-label" htmlFor="post-event">Distribution <Req /></label>
                  <select id="post-event" className={`form-select${errors.event ? " is-invalid" : ""}`} value={eventId} onChange={(e) => chooseEvent(e.target.value)} disabled={saving || !distributions}>
                    <option value="" disabled>{distributions ? (distributions.length ? "Choose the distribution" : "No ongoing distributions") : "Loading distributions…"}</option>
                    {(distributions ?? []).map((d) => (
                      <option key={d.id} value={String(d.id)}>{d.program} · {formatDate(d.date)} · Barangay {d.barangay}</option>
                    ))}
                  </select>
                  {errors.event && <div className="agri-post-field-error" role="alert">{errors.event}</div>}
                </div>

                <div className="agri-post-field">
                  <div className="agri-form-label" id="post-target">Who can see this? <Req /></div>
                  <div className="agri-post-switch agri-post-switch-3" role="radiogroup" aria-labelledby="post-target">
                    {TARGETS.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={target === value}
                        className={target === value ? "on" : ""}
                        onClick={() => {
                          setTarget(value);
                          clear("target");
                          if (value === "choose" && chosen.length === 0 && tagged) setChosen(tagged);
                        }}
                        disabled={saving || !eventId}
                      >
                        {value === "tagged" && tagged ? `${label} (${tagged.length})` : label}
                      </button>
                    ))}
                  </div>
                  {target === "choose" && eventId && (
                    <div style={{ marginTop: 8 }}>
                      <FarmerTagInput
                        taggedFarmers={chosen}
                        onAddFarmer={(f) => {
                          setChosen((list) => (list.some((x) => x.farmerId === f.id) ? list : [...list, { farmerId: f.id, firstName: f.firstName, lastName: f.lastName }]));
                          clear("target");
                        }}
                        onRemoveFarmer={(farmerId) => setChosen((list) => list.filter((x) => x.farmerId !== farmerId))}
                        disabled={saving}
                      />
                    </div>
                  )}
                  {errors.target && <div className="agri-post-field-error" role="alert">{errors.target}</div>}
                </div>
              </>
            ) : (
              <>
            <div className="agri-post-field">
              <div className="agri-form-label" id="post-who">Who can see this? <Req /></div>
              <div className="agri-post-chips" role="group" aria-labelledby="post-who">
                {[["farmers", "Farmers"], ["fa", "Farmers' Association Presidents"]].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`agri-post-chip${who[key] ? " on" : ""}${errors.audience ? " invalid" : ""}`}
                    aria-pressed={who[key]}
                    onClick={() => toggleWho(key)}
                    disabled={saving}
                  >
                    {who[key] && <Check size={14} aria-hidden="true" />} {label}
                  </button>
                ))}
              </div>
              {errors.audience && <div className="agri-post-field-error" role="alert">{errors.audience}</div>}
            </div>

            <div className="agri-post-field">
              <div className="agri-form-label" id="post-brgy">Barangays <Req /></div>
              <div className="agri-post-switch" role="radiogroup" aria-labelledby="post-brgy">
                {[[true, "All barangays"], [false, "Choose barangays"]].map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={allBarangays === value}
                    className={allBarangays === value ? "on" : ""}
                    onClick={() => {
                      setAllBarangays(value);
                      clear("barangays");
                    }}
                    disabled={saving}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!allBarangays && (
                <BarangayPicker
                  barangays={barangays}
                  value={barangayIds}
                  onChange={(ids) => {
                    setBarangayIds(ids);
                    clear("barangays");
                  }}
                  invalid={!!errors.barangays}
                  disabled={saving}
                />
              )}
              {errors.barangays && <div className="agri-post-field-error" role="alert">{errors.barangays}</div>}
            </div>
              </>
            )}

            <div className={`agri-post-summary${summary ? "" : " pending"}`} aria-live="polite">
              {summary ? <><Eye size={13} aria-hidden="true" /> {summary}</> : schedule ? "Choose the distribution." : "Choose who can see this post and where."}
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
                  setTitle(e.target.value);
                  clear("title");
                }}
                disabled={saving}
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
              <input id="post-venue" className="form-control" value={venue} placeholder="e.g. Langapod Barangay Hall" maxLength={200} onChange={(e) => setVenue(e.target.value)} disabled={saving} />
            </div>

            <div className="agri-post-field">
              <div className="agri-post-label-row">
                <label className="agri-form-label" htmlFor="post-details">Details <Opt /></label>
                <span className={`agri-post-count${bodyTooLong ? " over" : ""}`} aria-live="polite">{body.length.toLocaleString()}/{MAX_BODY.toLocaleString()}</span>
              </div>
              <textarea
                id="post-details"
                ref={textRef}
                className={`form-control agri-post-text${errors.body ? " is-invalid" : ""}`}
                rows={4}
                placeholder="What farmers need to know: what to bring, who can join, requirements…"
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  clear("body");
                }}
                disabled={saving}
              />
              {errors.body && <div className="agri-post-field-error" role="alert">{errors.body}</div>}
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
