import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, ImageIcon, Pencil, Plus, Search, ShieldAlert, Trash2, Undo2, Wheat, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import Toast from "../components/ui/Toast.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import HarvestReportModal from "../components/harvest/HarvestReportModal.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { useRevealDetail } from "../hooks/useRevealDetail.js";
import {
  HARVEST_LIMITS,
  HARVEST_STATUSES,
  getHarvestPhotoUrl,
  listHarvestReports,
  removeHarvestReport,
  reviewHarvestReport,
  totals,
} from "../lib/api/harvest.js";
import { formatHectares, formatKg } from "../lib/allocation.js";
import { formatDate, formatDateNumeric, formatDateTime } from "../lib/dates.js";
import { friendlyError } from "../lib/friendlyError.js";
import { rowLinkProps } from "../lib/rowLink.js";

const FILTERS = [{ value: "all", label: "All" }, ...HARVEST_STATUSES];
const fmtNum = (n, digits = 2) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: digits }));
const listHarvest = () => listHarvestReports();

// Harvest (MAO Admin and Farmers' Association President): every reported
// harvest, in kilograms. The MAO Admin verifies or returns (with remarks);
// both can add a report for a farmer. Farmers report from the mobile app.
export default function Harvest() {
  const { user } = useAuth();
  const isMAO = user?.role === "MAO Admin";
  const [searchParams] = useSearchParams();
  const { data: reports, setData: setReports, loading, error: loadError } = useSupabaseList(listHarvest);
  const [filter, setFilter] = useState(() => (HARVEST_STATUSES.some((x) => x.value === searchParams.get("status")) ? searchParams.get("status") : "all"));
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [cropFilter, setCropFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(() => Number(searchParams.get("id")) || null);
  const [modal, setModal] = useState(null); // null | { report: null | report }
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const remarksRef = useRef(null);
  const [toast, setToast] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [lightbox, setLightbox] = useState(false);

  // A notification link (?id=…) clicked while already on this page.
  useEffect(() => {
    const id = Number(searchParams.get("id"));
    if (id) {
      setSelectedId(id);
      setFilter("all");
    }
  }, [searchParams]);

  const seasons = useMemo(() => [...new Set(reports.map((r) => r.seasonLabel))], [reports]);
  const crops = useMemo(() => [...new Set(reports.map((r) => r.crop))].sort(), [reports]);

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reports.filter(
      (r) =>
        (seasonFilter === "all" || r.seasonLabel === seasonFilter) &&
        (cropFilter === "all" || r.crop === cropFilter) &&
        (!q || r.farmerName.toLowerCase().includes(q) || r.rsbsaNo.toLowerCase().includes(q)),
    );
  }, [reports, search, seasonFilter, cropFilter]);
  const filtered = useMemo(() => (filter === "all" ? searched : searched.filter((r) => r.statusKey === filter)), [searched, filter]);
  const counts = useMemo(() => {
    const c = { all: searched.length };
    for (const r of searched) c[r.statusKey] = (c[r.statusKey] ?? 0) + 1;
    return c;
  }, [searched]);
  const sum = useMemo(() => totals(filtered), [filtered]);

  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: filtered.length > 0 });
  useCardLabels(tableRef);
  const detailRef = useRef(null);
  const revealDetail = useRevealDetail(detailRef);
  const { page, setPage, totalPages, pageItems } = usePagination(filtered, pageSize);

  useEffect(() => {
    if (loading) return;
    if (!filtered.some((r) => r.id === selectedId)) setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId, loading]);

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  // Show the page that has the selected report (e.g. opened from a link).
  useEffect(() => {
    const index = filtered.findIndex((r) => r.id === selectedId);
    if (index >= 0 && pageSize > 0) setPage(Math.floor(index / pageSize) + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pageSize]);

  useEffect(() => {
    setRemarks("");
    setActionError("");
    setPhotoUrl(null);
    if (!selected?.photoPath) return undefined;
    let cancelled = false;
    getHarvestPhotoUrl(selected.photoPath)
      .then((url) => !cancelled && setPhotoUrl(url))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.photoPath]);

  const canEdit = selected && selected.statusKey !== "verified" && (isMAO || selected.submittedBy === user?.id);
  const canRemove = selected && (isMAO || (selected.submittedBy === user?.id && selected.statusKey !== "verified"));

  async function review(status) {
    if (!selected || savingRef.current) return;
    if (status === "returned" && !remarks.trim()) {
      setActionError("Give the farmer a reason for returning the report.");
      remarksRef.current?.focus();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setActionError("");
    try {
      const updated = await reviewHarvestReport(selected.id, status, remarks);
      setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setToast({ tone: "success", message: status === "verified" ? "Harvest report verified. The farmer was notified." : "Harvest report returned. The farmer was notified." });
    } catch (err) {
      const message = friendlyError(err, "Couldn't save this decision. Please try again.");
      setActionError(message);
      setToast({ tone: "error", message });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await removeHarvestReport(selected.id);
      setReports((prev) => prev.filter((r) => r.id !== selected.id));
      setToast({ tone: "success", message: "Harvest report removed." });
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Couldn't remove this harvest report. Please try again.") });
    } finally {
      setConfirmRemove(false);
      savingRef.current = false;
      setSaving(false);
    }
  }

  const filtersOn = search || seasonFilter !== "all" || cropFilter !== "all" || filter !== "all";

  return (
    <div className="agri-fill-root">
      <div className={`agri-split agri-harvest-split${selected ? " has-detail" : ""}`}>
        <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
          {loadError && <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{loadError}</div>}
          <div className="agri-harvest-summary" aria-label="Harvest summary">
            <div><span>Reports</span><strong>{sum.count.toLocaleString()}</strong></div>
            <div><span>Total Harvest</span><strong>{formatKg(sum.kg)}</strong></div>
            <div><span>Area Harvested</span><strong>{sum.ha > 0 ? formatHectares(sum.ha) : "—"}</strong></div>
            <div><span>Average Yield</span><strong>{sum.perHa != null ? `${fmtNum(sum.perHa)} kg/ha` : "—"}</strong></div>
          </div>
          <div className="agri-toolbar">
            <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setModal({ report: null })}>
              <Plus size={16} /> Add Harvest Report
            </button>
            <div className="agri-toolbar-search">
              <Search size={15} />
              <input className="form-control" placeholder="Search farmer or RSBSA No." aria-label="Search harvest reports" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "140px" }} aria-label="Filter by season" value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
              <option value="all">All Seasons</option>
              {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "170px" }} aria-label="Filter by crop" value={cropFilter} onChange={(e) => setCropFilter(e.target.value)}>
              <option value="all">All Crops</option>
              {crops.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="agri-filter-chips" role="tablist" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" role="tab" aria-selected={filter === f.value} className={`agri-filter-chip${filter === f.value ? " active" : ""}`} onClick={() => setFilter(f.value)}>
                {f.label}
                <span className="agri-filter-chip-count">{counts[f.value] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="agri-table-wrap" ref={tableRef}>
            <table className="agri-table agri-table-cards agri-harvest-table">
              <thead>
                <tr>
                  <th>RSBSA No.</th><th>Farmer</th><th>Crop / Type</th><th>Season</th>
                  <th className="text-end">Area (ha)</th><th className="text-end">Harvest (kg)</th><th className="text-end">kg/ha</th><th>Date</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={r.id} {...rowLinkProps(() => { setSelectedId(r.id); revealDetail(); }, { selected: r.id === selectedId })}>
                    <td className="agri-cell-truncate" title={r.rsbsaNo}>{r.rsbsaNo || "—"}</td>
                    <td className="agri-cell-truncate" title={r.farmerName}><span className="agri-row-title">{r.farmerName}</span></td>
                    <td className="agri-cell-truncate" title={r.crop}>{r.typeName || r.commodityName}{r.typeName && <div className="agri-muted agri-cell-truncate" style={{ fontSize: "0.72rem" }}>{r.commodityName}</div>}</td>
                    <td>{r.seasonLabel}</td>
                    <td className="text-end">{fmtNum(r.areaHa)}</td>
                    <td className="text-end">{fmtNum(r.yieldKg)}</td>
                    <td className="text-end">{fmtNum(r.yieldPerHa)}</td>
                    <td>{formatDateNumeric(r.harvestDate)}</td>
                    <td><Pill status={r.status} /></td>
                  </tr>
                ))}
                {loading && <tr><td colSpan={9} className="agri-muted text-center py-4">Loading harvest reports…</td></tr>}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && (
              <EmptyState
                icon={Wheat}
                title="No harvest reports found"
                hint={filtersOn ? "Try a different search or clear the filters." : "Harvests farmers report from the mobile app appear here. You can also add one for a farmer."}
              />
            )}
          </div>
          <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["report", "reports"]} />
        </div>

        {selected && (
          <div ref={detailRef} className="agri-card agri-fill-card" style={{ padding: 18 }}>
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Harvest Report</div>
              <Pill status={selected.status} />
            </div>
            <div className="agri-detail-body">
              <div className="agri-detail-row">
                <div>
                  <div className="agri-detail-label">Farmer</div>
                  {selected.farmerName}
                  <div className="agri-muted" style={{ fontSize: "0.78rem" }}>RSBSA {selected.rsbsaNo || "—"} · {[selected.sitioPurok, selected.barangay].filter(Boolean).join(", ")} · Farm size {formatHectares(selected.farmSize)}</div>
                </div>
              </div>
              <div className="agri-detail-grid">
                <div><div className="agri-detail-label">Crop / Type</div>{selected.crop}</div>
                <div><div className="agri-detail-label">Season</div>{selected.seasonLabel}</div>
                <div><div className="agri-detail-label">Area Harvested</div>{formatHectares(selected.areaHa)}</div>
                <div><div className="agri-detail-label">Harvest</div>{formatKg(selected.yieldKg)}</div>
                <div><div className="agri-detail-label">Yield</div>{selected.yieldPerHa != null ? `${fmtNum(selected.yieldPerHa)} kg/ha` : "—"}</div>
                <div><div className="agri-detail-label">Harvest Date</div>{formatDate(selected.harvestDate)}</div>
              </div>
              {selected.remarks && (
                <div className="agri-detail-row"><div><div className="agri-detail-label">Remarks</div><span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{selected.remarks}</span></div></div>
              )}

              <div className="agri-detail-section-title">Photo and Location</div>
              {selected.photoPath ? (
                photoUrl ? (
                  <img src={photoUrl} alt={`Harvest of ${selected.farmerName}`} className="agri-proof-photo agri-harvest-photo" onClick={() => setLightbox(true)} />
                ) : (
                  <div className="agri-proof-photo agri-proof-photo-empty agri-harvest-photo"><ImageIcon size={28} color="var(--agri-icon-faint)" /></div>
                )
              ) : (
                <div className="agri-muted" style={{ fontSize: "0.82rem" }}>No photo was attached.</div>
              )}
              {selected.latitude != null && selected.longitude != null && (
                <>
                  <iframe title="Harvest location" className="agri-map-frame agri-harvest-map" src={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}&z=15&output=embed`} loading="lazy" />
                  <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 6 }}>
                    {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}
                    {selected.gpsAccuracy != null && ` · ±${Math.round(selected.gpsAccuracy)} m`}
                    {selected.photoCapturedAt && ` · captured ${formatDateTime(selected.photoCapturedAt)}`}
                  </div>
                </>
              )}

              <div className="agri-detail-section-title">Timeline</div>
              <ol className="agri-timeline">
                <li className="agri-timeline-step done">
                  <span className="agri-timeline-dot" aria-hidden="true" />
                  <div className="agri-timeline-title">Submitted</div>
                  <div className="agri-timeline-meta">
                    {selected.filedByStaff ? `by ${selected.submitterName} (${selected.filedByFa ? "Farmers' Association President" : "MAO Admin"}) for the farmer` : `by ${selected.farmerName}`} · {formatDateTime(selected.createdAt)}
                  </div>
                </li>
                {selected.resubmittedAt && (
                  <li className="agri-timeline-step done">
                    <span className="agri-timeline-dot" aria-hidden="true" />
                    <div className="agri-timeline-title">Corrected and resubmitted</div>
                    <div className="agri-timeline-meta">{formatDateTime(selected.resubmittedAt)}</div>
                    {selected.reviewRemarks && <div className="agri-timeline-remarks">Returned earlier: “{selected.reviewRemarks}”</div>}
                  </li>
                )}
                {selected.statusKey === "submitted" ? (
                  <li className="agri-timeline-step waiting">
                    <span className="agri-timeline-dot" aria-hidden="true" />
                    <div className="agri-timeline-title">Waiting for the MAO Admin to verify</div>
                  </li>
                ) : (
                  <li className={`agri-timeline-step ${selected.statusKey === "returned" ? "rejected" : "done"}`}>
                    <span className="agri-timeline-dot" aria-hidden="true" />
                    <div className="agri-timeline-title">{selected.status} by the MAO</div>
                    <div className="agri-timeline-meta">by {selected.reviewerName} · {selected.reviewedAt ? formatDateTime(selected.reviewedAt) : "date not recorded"}</div>
                    {selected.reviewRemarks && <div className="agri-timeline-remarks">“{selected.reviewRemarks}”</div>}
                  </li>
                )}
              </ol>
            </div>

            <div className="agri-detail-actions">
              {actionError && <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 10, padding: "8px 12px" }}>{actionError}</div>}
              {isMAO && selected.statusKey === "submitted" && (
                <div>
                  <label className="agri-form-label" htmlFor="harvest-review-remarks">Remarks <span className="agri-muted" style={{ fontWeight: 400 }}>(required to return)</span></label>
                  <textarea
                    id="harvest-review-remarks"
                    ref={remarksRef}
                    className="form-control mb-3"
                    rows={2}
                    maxLength={HARVEST_LIMITS.remarks}
                    value={remarks}
                    onChange={(e) => { setRemarks(e.target.value); setActionError(""); }}
                    placeholder="Shown to the farmer"
                    disabled={saving}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn btn-outline-danger flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => review("returned")} disabled={saving}>
                      <Undo2 size={14} /> Return
                    </button>
                    <button type="button" className="btn btn-agri-primary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={() => review("verified")} disabled={saving}>
                      <CheckCircle2 size={14} /> {saving ? "Saving…" : "Verify"}
                    </button>
                  </div>
                </div>
              )}
              {(canEdit || canRemove) && (
                <div className="agri-detail-actions-row" style={{ marginTop: isMAO && selected.statusKey === "submitted" ? 8 : 0 }}>
                  {canEdit && (
                    <button type="button" className="btn agri-detail-btn agri-detail-btn-edit d-flex align-items-center justify-content-center gap-2" onClick={() => setModal({ report: selected })} disabled={saving}>
                      <Pencil size={16} /> {selected.statusKey === "returned" ? "Correct and Resubmit" : "Edit"}
                    </button>
                  )}
                  {canRemove && (
                    <button type="button" className="btn agri-detail-btn agri-detail-btn-delete d-flex align-items-center justify-content-center gap-2" onClick={() => setConfirmRemove(true)} disabled={saving}>
                      <Trash2 size={16} /> Remove
                    </button>
                  )}
                </div>
              )}
              {!isMAO && !canEdit && (
                <div className="agri-pill gray" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px" }}>
                  <ShieldAlert size={13} style={{ flex: "none" }} />
                  {selected.statusKey === "verified" ? "Verified by the MAO." : selected.statusKey === "returned" ? "Returned to the farmer for correction." : "Waiting for the MAO to verify."}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {modal && (
        <HarvestReportModal
          report={modal.report}
          onClose={() => setModal(null)}
          onSaved={(saved) => {
            setReports((prev) => (prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev]));
            setSelectedId(saved.id);
            setFilter("all");
            setModal(null);
            setToast({ tone: "success", message: modal.report ? (modal.report.statusKey === "returned" ? "Harvest report resubmitted to the MAO." : "Harvest report updated.") : "Harvest report added. The MAO will verify it." });
          }}
        />
      )}

      {confirmRemove && selected && (
        <ConfirmDialog
          title="Remove this harvest report?"
          message={`${selected.farmerName}'s ${selected.seasonLabel} report (${formatKg(selected.yieldKg)}) will be removed from the list and reports. The record is kept in the Activity Log.`}
          confirmLabel="Remove"
          busy={saving}
          onConfirm={remove}
          onCancel={() => setConfirmRemove(false)}
        />
      )}

      {lightbox && photoUrl && (
        <div className="agri-lightbox" onClick={() => setLightbox(false)}>
          <button type="button" className="agri-icon-btn" aria-label="Close photo" style={{ position: "absolute", top: 20, right: 20, background: "var(--agri-card)" }} onClick={() => setLightbox(false)}>
            <X size={16} />
          </button>
          <img src={photoUrl} alt={`Harvest of ${selected?.farmerName ?? "the farmer"}`} onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}
