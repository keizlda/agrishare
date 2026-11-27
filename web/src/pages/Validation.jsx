import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Inbox, Search } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import Toast from "../components/ui/Toast.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import FarmerAvatar from "../components/ui/FarmerAvatar.jsx";
import SubmissionView from "../components/validation/SubmissionView.jsx";
import KindTag from "../components/validation/KindTag.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { KINDS, STATUS_FILTERS, TYPE_TABS, applyFilters, filterQuery, loadInbox, readFilters } from "../lib/validationInbox.js";
import BarangayFilter from "../components/lists/BarangayFilter.jsx";
import { useBarangays } from "../hooks/useBarangays.js";
import { formatDate } from "../lib/dates.js";
import { rowLinkProps } from "../lib/rowLink.js";

const EMPTY = {
  pending: ["No pending submissions", "Everything has been reviewed."],
  approved: ["No approved submissions", "Approved proof of planting and harvest reports appear here."],
  rejected: ["No rejected submissions", "Rejected proof of planting and harvest reports appear here."],
  all: ["No submissions yet", "Proof of planting and harvest reports from farmers appear here."],
};

// Validation inbox (MAO Admin and Farmers' Association President): proof of
// planting and harvest reports in one list, like an email inbox. Opening one
// (/validation/planting/:id or /validation/harvest/:id) shows it in the same
// card. The filters, search and page live in the URL, so Back, refresh and
// shared links keep them.
export default function Validation() {
  const { user } = useAuth();
  const isMAO = user?.role === "MAO Admin";
  const { kind, id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = readFilters(searchParams);
  const qs = filterQuery(filters);
  const { data: items, setData: setItems, loading, error: loadError } = useSupabaseList(loadInbox);
  const [toast, setToast] = useState(null);
  // The last submission opened keeps a subtle highlight back in the list.
  const [lastOpened, setLastOpened] = useState(null);
  useEffect(() => {
    if (kind) setLastOpened(`${kind}-${id}`);
  }, [kind, id]);

  const barangays = useBarangays();
  const filtered = useMemo(() => applyFilters(items, filters, barangays), [items, filters.type, filters.status, filters.q, filters.barangay, barangays]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingCounts = useMemo(() => {
    const c = { all: 0, planting: 0, harvest: 0 };
    for (const i of items) if (i.group === "pending") { c.all++; c[i.kind]++; }
    return c;
  }, [items]);

  function setFilters(next) {
    setSearchParams(new URLSearchParams(filterQuery({ ...filters, page: 1, ...next }).slice(1)), { replace: true });
  }

  const openItem = useCallback((item) => navigate(`/validation/${item.kind}/${item.id}${qs}`), [navigate, qs]);
  const backToList = useCallback(() => navigate(`/validation${qs}`), [navigate, qs]);

  // A changed or added item replaces the old one (or goes on top).
  const putItem = useCallback(
    (item) => setItems((prev) => (prev.some((i) => i.key === item.key) ? prev.map((i) => (i.key === item.key ? item : i)) : [item, ...prev])),
    [setItems],
  );

  const toastEl = toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />;

  if (kind) {
    const item = items.find((i) => i.kind === kind && String(i.id) === String(id)) ?? null;
    return (
      <div className="agri-fill-root">
        <SubmissionView
          key={`${kind}-${id}`}
          item={item}
          loading={loading}
          loadError={loadError}
          list={filtered}
          user={user}
          isMAO={isMAO}
          onBack={backToList}
          onOpen={openItem}
          onChanged={putItem}
          onRemoved={(removed) => setItems((prev) => prev.filter((i) => i.key !== removed.key))}
          onToast={setToast}
        />
        {toastEl}
      </div>
    );
  }

  return (
    <div className="agri-fill-root">
      <InboxList
          barangays={barangays}
        filters={filters}
        filtered={filtered}
        pendingCounts={pendingCounts}
        loading={loading}
        loadError={loadError}
        onFilters={setFilters}
        onPage={(page) => setSearchParams(new URLSearchParams(filterQuery({ ...filters, page }).slice(1)), { replace: true })}
        onOpen={openItem}
        lastOpened={lastOpened}
      />
      {toastEl}
    </div>
  );
}

function InboxList({ filters, filtered, barangays, pendingCounts, loading, loadError, onFilters, onPage, onOpen, lastOpened }) {
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: filtered.length > 0 });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(filters.page, totalPages);
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  const [title, hint] = filters.q || filters.barangay !== "all" ? [filters.q ? `No submissions match “${filters.q}”` : "No submissions in this barangay", "Try another name, RSBSA no. or barangay, or change the filters."] : EMPTY[filters.status];

  return (
    <div className="agri-card agri-fill-card agri-vinbox">
      {loadError && <div className="agri-pill red" role="alert" style={{ display: "block", margin: "12px 16px 0", padding: "8px 12px" }}>{loadError}</div>}
      <div className="agri-vinbox-bar">
        <h1 className="agri-vinbox-title">Validation</h1>
        <div className="agri-text-tabs" role="tablist" aria-label="Submission type">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={filters.type === t.value}
              className={`agri-text-tab${filters.type === t.value ? " active" : ""}`}
              onClick={() => onFilters({ type: t.value })}
            >
              {t.label}
              {pendingCounts[t.value] > 0 && <span className="agri-text-tab-count" title={`${pendingCounts[t.value]} pending`}>{pendingCounts[t.value]}</span>}
            </button>
          ))}
        </div>
        <div className="agri-toolbar-search agri-vinbox-search">
          <Search size={15} />
          <input className="form-control" placeholder="Search farmer name or RSBSA no." aria-label="Search submissions" value={filters.q} onChange={(e) => onFilters({ q: e.target.value })} />
        </div>
        <select className="form-select agri-vinbox-status" aria-label="Filter by status" value={filters.status} onChange={(e) => onFilters({ status: e.target.value })}>
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <BarangayFilter className="agri-vinbox-barangay" barangays={barangays} value={filters.barangay} onChange={(v) => onFilters({ barangay: v })} />
      </div>

      <div className="agri-table-wrap agri-vinbox-list" ref={tableRef}>
        <table className="agri-table agri-vinbox-table">
          <caption className="visually-hidden">Submissions, newest first. Pending ones are in bold.</caption>
          <tbody>
            {pageItems.map((i) => {
              const pending = i.group === "pending";
              const submitted = `Submitted ${formatDate(i.date)}`;
              const detail = [i.barangay && `Brgy. ${i.barangay}`, i.rsbsaNo, i.summary, submitted].filter(Boolean).join(" · ");
              const label = `${i.farmerName}, ${KINDS[i.kind]}, ${detail}, ${i.status}${pending ? ", pending" : ""}`;
              return (
                <tr
                  key={i.key}
                  {...rowLinkProps(() => onOpen(i), { selected: i.key === lastOpened })}
                  aria-label={label}
                  className={`agri-row-link agri-vinbox-row${pending ? " unread" : ""}${i.key === lastOpened ? " selected" : ""}`}
                >
                  <td className="agri-vinbox-dot-cell">{pending && <span className="agri-vinbox-dot" aria-hidden="true" />}</td>
                  <td className="agri-vinbox-avatar"><FarmerAvatar url={i.avatarUrl} firstName={i.firstName} lastName={i.lastName} size={40} /></td>
                  <td className="agri-vinbox-main">
                    <div className="agri-vinbox-main-inner">
                      <div className="agri-vinbox-text">
                        <div className="agri-vinbox-name" title={i.farmerName}>{i.farmerName}</div>
                        <div className="agri-vinbox-sub" title={detail}>{detail}</div>
                      </div>
                      <KindTag kind={i.kind} soft />
                    </div>
                  </td>
                  <td className="agri-vinbox-status-cell"><Pill status={i.status} /></td>
                  <td className="agri-vinbox-date">{formatDate(i.date)}</td>
                </tr>
              );
            })}
            {loading && <tr><td colSpan={5} className="agri-muted text-center py-4">Loading submissions…</td></tr>}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && <EmptyState icon={Inbox} title={title} hint={hint} />}
      </div>
      <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={onPage} noun={["submission", "submissions"]} />
    </div>
  );
}

