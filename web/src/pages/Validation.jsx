import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Filter,
  Image as ImageIcon,
  Search,
  ShieldCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import Pill from "../components/ui/Pill.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import Toast from "../components/ui/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { getSignedPhotoUrl, listSubmissions, rejectSubmission, validateSubmission } from "../lib/api/cropValidation.js";
import { listFarmers } from "../lib/api/farmers.js";

const PAGE_SIZE = 15;
const STATUS_TABS = ["All", "Pending", "Validated", "Rejected"];

// Barangay Langapud's approximate center — the schema has no per-parcel GPS
// coordinates, so this is the only geographic anchor available to flag a
// submission photo that's obviously nowhere near the declared parcel.
const LANGAPUD_REF = { lat: 7.8333, lng: 123.6333 };

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function relativeTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Validation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isReviewer = user?.role === "MAO Admin" || user?.role === "FA President";

  const { data: submissions, setData: setSubmissions, loading, error: loadError } = useSupabaseList(listSubmissions);
  const [farmers, setFarmers] = useState([]);
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState("Pending");
  const [sort, setSort] = useState("Newest first");
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [viewedIds, setViewedIds] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    listFarmers().then(setFarmers).catch(() => {});
  }, []);

  const counts = useMemo(() => {
    const c = { All: submissions.length, Pending: 0, Validated: 0, Rejected: 0 };
    for (const s of submissions) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [submissions]);

  const filtered = useMemo(() => {
    let list = submissions.filter((s) => statusTab === "All" || s.status === statusTab);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.farmer?.fullName.toLowerCase().includes(q) || s.farmer?.rsbsaNo.includes(search));
    }
    list = [...list].sort((a, b) => {
      const diff = new Date(a.submittedAt) - new Date(b.submittedAt);
      return sort === "Newest first" ? -diff : diff;
    });
    return list;
  }, [submissions, statusTab, search, sort]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);

  const selected = submissions.find((s) => s.id === selectedId) ?? null;

  function selectRow(id) {
    setSelectedId(id);
    setMobileDetailOpen(true);
    setViewedIds((prev) => new Set(prev).add(id));
  }

  // Up/Down moves the selection through the current page, Escape backs out
  // of the mobile full-screen detail — skipped while typing in a field.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Escape") setMobileDetailOpen(false);
        return;
      }
      if (e.key === "Escape") {
        setMobileDetailOpen(false);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (pageItems.length === 0) return;
      e.preventDefault();
      const idx = pageItems.findIndex((s) => s.id === selectedId);
      const nextIdx =
        e.key === "ArrowDown" ? Math.min(idx + 1, pageItems.length - 1) : Math.max(idx - 1, 0);
      selectRow(pageItems[Math.max(nextIdx, 0)].id);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageItems, selectedId]);

  function goToFarmerProfile(rsbsaNo) {
    navigate("/farmers", { state: { presetSearch: rsbsaNo } });
  }

  async function handleReview(status, remarksText) {
    if (!selected) return;
    try {
      const updated = status === "validated" ? await validateSubmission(selected.id, remarksText) : await rejectSubmission(selected.id, remarksText);
      setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setToast({ tone: "success", message: status === "validated" ? "Submission validated." : "Submission rejected." });
    } catch (err) {
      setToast({ tone: "error", message: err.message });
    }
  }

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={ShieldCheck} label="Validated" value={counts.Validated} sub="Proof submissions" color="green" />
        <StatCard icon={Clock} label="Pending Validation" value={counts.Pending} sub="Awaiting review" color="orange" />
        <StatCard icon={Users} label="Rejected" value={counts.Rejected} sub="Proof submissions" color="red" />
      </OverviewDrawer>

      <div className="agri-card" style={{ padding: 0, overflow: "hidden" }}>
        {loadError && (
          <div className="agri-pill red" style={{ display: "block", margin: 16, padding: "8px 12px" }}>
            {loadError}
          </div>
        )}

        <div className={`agri-inbox${mobileDetailOpen ? " detail-open" : ""}`}>
          <div className="agri-inbox-list" ref={listRef}>
            <div className="agri-inbox-list-header">
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#8b978f" }} />
                  <input
                    className="form-control"
                    placeholder="Search by farmer name or RSBSA no."
                    style={{ paddingLeft: 32 }}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button className="agri-icon-btn"><Filter size={16} /></button>
              </div>

              <div className="agri-filter-pills">
                {STATUS_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`agri-filter-pill${statusTab === tab ? " active" : ""}`}
                    onClick={() => setStatusTab(tab)}
                  >
                    {tab} <span className="agri-filter-pill-count">{counts[tab] ?? 0}</span>
                  </button>
                ))}
              </div>

              <select className="form-select" style={{ marginTop: 10 }} value={sort} onChange={(e) => setSort(e.target.value)}>
                <option>Newest first</option>
                <option>Oldest first</option>
              </select>
            </div>

            <div className="agri-inbox-rows">
              {loading && <div className="agri-muted text-center py-4" style={{ fontSize: "0.85rem" }}>Loading submissions…</div>}

              {!loading && pageItems.length === 0 && (
                <div className="agri-inbox-empty">
                  <ImageIcon size={28} color="#b7c2ba" />
                  <div>No submissions to review.</div>
                </div>
              )}

              {pageItems.map((s) => {
                const isUnread = s.status === "Pending" && !viewedIds.has(s.id);
                const dueForRevalidation = s.status === "Validated" && s.farmer?.status === "Inactive";
                return (
                  <SubmissionRow
                    key={s.id}
                    submission={s}
                    active={s.id === selectedId}
                    unread={isUnread}
                    flagged={dueForRevalidation}
                    onClick={() => selectRow(s.id)}
                  />
                );
              })}
            </div>

            <div style={{ padding: "10px 16px" }}>
              <div className="agri-muted" style={{ fontSize: "0.78rem" }}>
                Showing {pageItems.length} of {filtered.length} submissions
              </div>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          </div>

          <div className="agri-inbox-detail">
            {selected ? (
              <SubmissionDetail
                submission={selected}
                isReviewer={isReviewer}
                onBack={() => setMobileDetailOpen(false)}
                onReview={handleReview}
                onViewFarmerProfile={() => goToFarmerProfile(selected.farmer?.rsbsaNo)}
              />
            ) : (
              <div className="agri-detail-empty">
                <ImageIcon size={32} color="#b7c2ba" />
                <div>Select a submission to review.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

function SubmissionRow({ submission, active, unread, flagged, onClick }) {
  const [thumb, setThumb] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getSignedPhotoUrl(submission.photoPath)
      .then((url) => { if (!cancelled) setThumb(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [submission.photoPath]);

  return (
    <button
      type="button"
      className={`agri-submission-row${active ? " active" : ""}${unread ? " unread" : ""}`}
      onClick={onClick}
    >
      {unread && <span className="agri-submission-dot" />}
      <div className="agri-submission-thumb">
        {thumb ? <img src={thumb} alt="" /> : <ImageIcon size={16} color="#b7c2ba" />}
        {flagged && <span className="agri-amber-marker" title="Inactive farmer with a validated submission — due for revalidation" />}
      </div>
      <div className="agri-submission-body">
        <div className="agri-submission-name">{submission.farmer?.fullName ?? "Unknown farmer"}</div>
        <div className="agri-submission-sub">{submission.farmer?.commodity || "—"} · {submission.farmer?.barangay}</div>
        <div className="agri-submission-time">{relativeTime(submission.submittedAt)}</div>
      </div>
      <Pill status={submission.status} />
    </button>
  );
}

function SubmissionDetail({ submission, isReviewer, onBack, onReview, onViewFarmerProfile }) {
  const [photoUrl, setPhotoUrl] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [saving, setSaving] = useState(false);

  const f = submission.farmer;

  useEffect(() => {
    setRemarks("");
    setRejectError("");
    setPhotoUrl(null);
    getSignedPhotoUrl(submission.photoPath).then(setPhotoUrl).catch(() => {});
  }, [submission.id, submission.photoPath]);

  const distanceKm =
    submission.latitude != null && submission.longitude != null
      ? haversineKm(submission.latitude, submission.longitude, LANGAPUD_REF.lat, LANGAPUD_REF.lng)
      : null;

  async function submitReview(status) {
    if (status === "rejected" && !remarks.trim()) {
      setRejectError("A remark is required when rejecting a submission.");
      return;
    }
    setRejectError("");
    setSaving(true);
    try {
      await onReview(status, remarks.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agri-detail-scroll">
      <button type="button" className="agri-back-btn" onClick={onBack}>
        <ArrowLeft size={15} /> Back to list
      </button>

      <div className="agri-detail-header">
        <div>
          <div className="agri-detail-farmer-name">{f?.fullName ?? "Unknown farmer"}</div>
          <div className="agri-muted" style={{ fontSize: "0.82rem" }}>{f?.rsbsaNo}</div>
        </div>
        <Pill status={submission.status} />
      </div>

      <Section title="Farmer Details">
        <div className="agri-kv-grid">
          <KV label="RSBSA Number" value={f?.rsbsaNo} />
          <KV label="Full Name" value={f?.fullName} />
          <KV label="Sex" value={f?.sex} />
          <KV label="Birth Date" value={f?.birthDate} />
          <KV label="Contact No." value={f?.contactNo || "—"} />
          <KV label="Address" value={f?.address || "—"} />
          <KV label="Commodity" value={f?.commodity || "—"} />
          <KV label="Farm Size (ha)" value={f?.farmSize != null ? f.farmSize : "—"} />
          <KV label="Farm Location" value={f?.farmLocation || "—"} />
          <KV label="Organization Affiliation" value={f?.orgAffiliation || "—"} />
          <div>
            <div className="agri-kv-label">Current Status</div>
            <Pill status={f?.status ?? "Inactive"} />
            <div className="agri-muted" style={{ fontSize: "0.7rem", marginTop: 4 }}>
              Status is updated separately from the farmer record.
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-link p-0" style={{ fontSize: "0.8rem", marginTop: 10 }} onClick={onViewFarmerProfile}>
          View full profile →
        </button>
      </Section>

      <Section title="Proof of Planting">
        {photoUrl ? (
          <img src={photoUrl} alt="Proof of planting" className="agri-proof-photo" onClick={() => setLightboxOpen(true)} />
        ) : (
          <div className="agri-proof-photo agri-proof-photo-empty"><ImageIcon size={28} color="#b7c2ba" /></div>
        )}
        <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
          Captured {submission.capturedAt ? new Date(submission.capturedAt).toLocaleString() : "—"}
        </div>
      </Section>

      <Section title="GPS Location">
        {submission.latitude != null && submission.longitude != null ? (
          <>
            <iframe
              title="Submission location"
              className="agri-map-frame"
              src={`https://www.google.com/maps?q=${submission.latitude},${submission.longitude}&z=15&output=embed`}
              loading="lazy"
            />
            <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>
              {submission.latitude.toFixed(6)}, {submission.longitude.toFixed(6)} · captured{" "}
              {submission.capturedAt ? new Date(submission.capturedAt).toLocaleString() : "—"}
            </div>
            {distanceKm != null && (
              <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 2 }}>
                ~{distanceKm.toFixed(1)} km from the Barangay Langapud reference point
                {distanceKm > 5 && (
                  <span style={{ color: "var(--agri-orange)", fontWeight: 600 }}> — far from the declared barangay, worth a closer look</span>
                )}
                <span title="Exact parcel coordinates aren't on file, so this compares against the barangay's approximate center."> ⓘ</span>
              </div>
            )}
          </>
        ) : (
          <div className="agri-muted" style={{ fontSize: "0.85rem" }}>No GPS data recorded for this submission.</div>
        )}
      </Section>

      {submission.status === "Pending" ? (
        isReviewer && (
          <Section title="Review Actions" last>
            <label className="agri-form-label">Remarks</label>
            <textarea
              className="form-control mb-2"
              rows={3}
              placeholder="Add a note about this submission (optional)"
              value={remarks}
              onChange={(e) => { setRemarks(e.target.value); setRejectError(""); }}
            />
            {rejectError && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginBottom: 8 }}>{rejectError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-outline-danger flex-fill" disabled={saving} onClick={() => submitReview("rejected")}>
                Reject
              </button>
              <button className="btn btn-agri-primary flex-fill" disabled={saving} onClick={() => submitReview("validated")}>
                Validate
              </button>
            </div>
          </Section>
        )
      ) : (
        <Section title="Review Summary" last>
          <div className="agri-review-summary">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {submission.status === "Validated" ? (
                <CheckCircle2 size={16} color="var(--agri-primary)" />
              ) : (
                <XCircle size={16} color="var(--agri-red)" />
              )}
              <strong>{submission.status}</strong>
            </div>
            <div className="agri-muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
              Reviewed by {submission.reviewedBy ?? "—"}
              {submission.reviewedAt ? ` on ${new Date(submission.reviewedAt).toLocaleString()}` : ""}
            </div>
            {submission.remarks && (
              <div style={{ fontSize: "0.85rem", marginTop: 8 }}>{submission.remarks}</div>
            )}

            {submission.status === "Validated" && (
              <div className="agri-status-nudge">
                <AlertTriangle size={14} color="var(--agri-orange)" style={{ flexShrink: 0 }} />
                <span>
                  Proof recorded. Update this farmer's status?{" "}
                  <button type="button" className="btn btn-link p-0" style={{ fontSize: "0.82rem" }} onClick={onViewFarmerProfile}>
                    Open farmer record
                  </button>
                </span>
              </div>
            )}
          </div>
        </Section>
      )}

      {lightboxOpen && photoUrl && (
        <div className="agri-lightbox" onClick={() => setLightboxOpen(false)}>
          <button type="button" className="agri-icon-btn" style={{ position: "absolute", top: 20, right: 20, background: "#fff" }} onClick={() => setLightboxOpen(false)}>
            <X size={16} />
          </button>
          <img src={photoUrl} alt="Proof of planting" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function Section({ title, children, last }) {
  return (
    <div className="agri-detail-section" style={{ marginBottom: last ? 0 : 20 }}>
      <div className="agri-detail-section-title">{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div>
      <div className="agri-kv-label">{label}</div>
      <div className="agri-kv-value">{value ?? "—"}</div>
    </div>
  );
}
