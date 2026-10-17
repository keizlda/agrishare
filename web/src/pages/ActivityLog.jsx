import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import Pill from "../components/ui/Pill.jsx";
import { ACTION_LABELS, ACTION_TYPES, ENTITY_LABELS, ENTITY_TYPES, listAuditLogs } from "../lib/api/auditLogs.js";
import { friendlyError } from "../lib/friendlyError.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";

const ACTION_PILL = { insert: "Published", update: "Ongoing", delete: "Rejected" };

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function ActivityLog() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("All");
  const [entityType, setEntityType] = useState("All");

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Rows per page = however many fit in the full-height table area (min 5),
  // fetched a page at a time. The first entry on screen is kept, so a resize
  // shows the page that still contains it.
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: rows.length > 0 });
  const [firstIndex, setFirstIndex] = useState(0);
  const page = Math.floor(firstIndex / pageSize) + 1;
  const setPage = (p) => setFirstIndex((Math.max(1, p) - 1) * pageSize);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listAuditLogs({ dateFrom, dateTo, action, entityType, page, pageSize })
      .then(({ rows: r, total: t }) => {
        if (cancelled) return;
        setRows(r);
        setTotal(t);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, "Couldn't load the activity log."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, action, entityType, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtersActive = dateFrom || dateTo || action !== "All" || entityType !== "All";

  function resetFilters() {
    setDateFrom("");
    setDateTo("");
    setAction("All");
    setEntityType("All");
    setPage(1);
  }

  return (
    <div className="agri-fill-root">
      <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
        {error && (
          <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div className="d-flex gap-2">
            <input type="date" className="form-control" style={{ width: 155 }} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} aria-label="From date" />
            <input type="date" className="form-control" style={{ width: 155 }} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} aria-label="To date" />
          </div>
          <select className="form-select" style={{ width: 160 }} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Filter by action">
            <option value="All">All Actions</option>
            {ACTION_TYPES.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
          </select>
          <select className="form-select" style={{ width: 190 }} value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} aria-label="Filter by entity type">
            <option value="All">All Entity Types</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
          </select>
        </div>

        <div className="agri-table-wrap" ref={tableRef}>
          <table className="agri-table">
            <thead>
              <tr><th>Date &amp; Time</th><th>User</th><th>Role</th><th>Action</th><th>Summary</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(r.createdAt)}</td>
                  <td>{r.userName}</td>
                  <td className="agri-wrap">{r.userRole}</td>
                  <td><Pill status={ACTION_PILL[r.action] ?? "Pending"}>{r.actionLabel}</Pill></td>
                  <td>{r.summary}</td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={5} className="agri-muted text-center py-4">Loading activity log…</td></tr>
              )}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <EmptyState
              icon={History}
              title="No activity found"
              hint={filtersActive ? "No activity matches these filters. Try a different range or clear the filters." : "Changes to farmers, distributions, commodities, and announcements will show up here."}
              action={
                filtersActive ? (
                  <button type="button" className="btn btn-outline-secondary btn-sm mt-2" onClick={resetFilters}>Clear filters</button>
                ) : undefined
              }
            />
          )}
        </div>

        <TableFooter page={page} pageSize={pageSize} total={total} totalPages={totalPages} onPageChange={setPage} noun={["activity log entry", "activity log entries"]} />
      </div>
    </div>
  );
}
