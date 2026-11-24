import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import RowActionsMenu from "../components/ui/RowActionsMenu.jsx";
import DateInput from "../components/ui/DateInput.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import { formatDate, formatDateTime } from "../lib/dates.js";
import { reportTypes } from "../data/mockData.js";
import { listCommodities } from "../lib/api/commodities.js";
import { listAllEntries } from "../lib/api/lists.js";
import { MapPin } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";

// Distribution reports filter by the distribution's status; the Harvest
// Report by the harvest report's.
const STATUS_OPTIONS = ["All Status", "Ongoing", "Completed"];
const HARVEST_STATUS_OPTIONS = ["All Status", "Submitted", "Verified", "Rejected"];
// List of Farmers: the farmer's own status, sex, type of farmer and
// farmers' association (types and associations: the lists in Settings).
const FARMER_STATUS_OPTIONS = ["All Status", "Active", "Inactive"];
const SEX_OPTIONS = ["All", "Male", "Female"];
const statusOptionsFor = (type) => (type === "Harvest Report" ? HARVEST_STATUS_OPTIONS : type === "List of Farmers" ? FARMER_STATUS_OPTIONS : STATUS_OPTIONS);

// Generated-report history is a session convenience log (what got downloaded,
// when) rather than domain data from the paper's ERD, so it stays local —
// there's no tbl_Reports to persist it to server-side.
export default function Reports() {
  const [reports, setReports] = usePersistedState("agrishare_reports", []);
  const [commodityOptions, setCommodityOptions] = useState([]);

  const [reportType, setReportType] = useState(reportTypes[0]);
  // No default date range — reports show everything unless the admin
  // narrows it. A hardcoded "2024-05" window here used to silently hide
  // every distribution recorded since (Part 2 fix).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [status, setStatus] = useState("All Status");
  const [commodity, setCommodity] = useState("All Commodities");
  const [farmerType, setFarmerType] = useState("All Types");
  // A Farmers' Association President's reports are always their barangay's.
  const { user } = useAuth();
  const isFA = user?.role === "FA President";
  const [barangay, setBarangay] = useState(isFA && user.barangayName ? user.barangayName : "All Barangays");
  const [sex, setSex] = useState("All");
  const [association, setAssociation] = useState("All");
  const [lists, setLists] = useState({ sitios: [], associations: [], crops: [], barangays: [], farmerTypes: [] });
  const farmerList = reportType === "List of Farmers";
  const [rangeError, setRangeError] = useState("");
  const tableRef = useRef(null);
  useCardLabels(tableRef);

  useEffect(() => {
    listCommodities()
      .then((rows) => setCommodityOptions(rows.filter((c) => c.status === "Active").map((c) => c.name)))
      .catch(() => {});
    listAllEntries().then(setLists).catch(() => {});
  }, []);

  // Opens the printable preview in a new tab. Nothing prints by itself: the
  // print dialog opens only from the preview's "Print / Save as PDF".
  function printUrl({ type, dateFrom, dateTo, status, commodity, barangay, sex = "All", association = "All", farmerType = "All Types" }) {
    const params = new URLSearchParams({ type, dateFrom, dateTo, status, commodity, barangay, sex, association, farmerType });
    return `/print/reports?${params.toString()}`;
  }

  function handleGenerate(e) {
    e.preventDefault();
    // Dates are "YYYY-MM-DD", so they compare correctly as text.
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setRangeError("The \"From\" date must be on or before the \"To\" date.");
      return;
    }
    setRangeError("");
    const id = `RPT-${String(reports.length + 29).padStart(3, "0")}`;
    setReports((prev) => [
      {
        id,
        name: `${reportType} — ${farmerList ? farmerType : commodity}`,
        type: reportType,
        dateGenerated: formatDateTime(new Date()),
        dateFrom,
        dateTo,
        status,
        commodity,
        barangay,
        sex: farmerList ? sex : "All",
        association: farmerList ? association : "All",
        farmerType: farmerList ? farmerType : "All Types",
      },
      ...prev,
    ]);
    window.open(printUrl({ type: reportType, dateFrom, dateTo, status, commodity: farmerList ? "All Commodities" : commodity, barangay, sex: farmerList ? sex : "All", association: farmerList ? association : "All", farmerType: farmerList ? farmerType : "All Types" }), "_blank", "noopener,noreferrer");
  }

  function handlePreview(r) {
    window.open(printUrl({ type: r.type, dateFrom: r.dateFrom, dateTo: r.dateTo, status: r.status ?? "All Status", commodity: r.commodity, barangay: r.barangay, sex: r.sex ?? "All", association: r.association ?? "All", farmerType: r.farmerType ?? "All Types" }), "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      <div className="agri-card agri-report-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Generate Report</div>
        <form onSubmit={handleGenerate}>
          <div className="agri-report-form-grid">
            <div>
              <label className="agri-form-label">Report Type</label>
              <select
                className="form-select mb-3"
                value={reportType}
                onChange={(e) => {
                  const next = e.target.value;
                  setReportType(next);
                  if (!statusOptionsFor(next).includes(status)) setStatus("All Status");
                }}
              >
                {reportTypes.map((t) => <option key={t}>{t}</option>)}
              </select>

              {farmerList ? (
                <>
                  <label className="agri-form-label" htmlFor="report-farmer-type">Type of Farmer</label>
                  <select id="report-farmer-type" className="form-select mb-3" value={farmerType} onChange={(e) => setFarmerType(e.target.value)}>
                    <option>All Types</option>
                    {lists.farmerTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </>
              ) : (
                <>
                  <label className="agri-form-label">{reportType === "Harvest Report" ? "Crop" : "Commodity"}</label>
                  <select className="form-select mb-3" value={commodity} onChange={(e) => setCommodity(e.target.value)}>
                    <option>All Commodities</option>
                    {commodityOptions.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </>
              )}

              <label className="agri-form-label">Status</label>
              <select className="form-select mb-3" value={status} onChange={(e) => setStatus(e.target.value)}>
                {statusOptionsFor(reportType).map((s) => <option key={s}>{s}</option>)}
              </select>

              {farmerList && (
                <>
                  <label className="agri-form-label" htmlFor="report-association">Farmers&apos; Association</label>
                  <select id="report-association" className="form-select mb-3" value={association} onChange={(e) => setAssociation(e.target.value)}>
                    <option value="All">All Associations</option>
                    {lists.associations.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                    <option value="None">No association</option>
                  </select>
                </>
              )}
            </div>

            <div>
              <label className="agri-form-label">{reportType === "Harvest Report" ? "Harvest Date Range" : farmerList ? "Date Registered (optional)" : "Date Range"}</label>
              <div className="agri-muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>{reportType === "Harvest Report" ? "Harvests with a harvest date in this range; totals follow it. Leave blank to include every date." : farmerList ? "Farmers registered in this range. Leave blank to include everyone." : "Leave blank to include every date."}</div>
              <div className={`agri-date-range ${rangeError ? "mb-1" : "mb-3"}`}>
                <DateInput value={dateFrom} onChange={(v) => { setDateFrom(v); setRangeError(""); }} invalid={!!rangeError} aria-label="From date" />
                <DateInput value={dateTo} onChange={(v) => { setDateTo(v); setRangeError(""); }} invalid={!!rangeError} aria-label="To date" />
              </div>
              {rangeError && <div className="mb-3" style={{ color: "var(--agri-red)", fontSize: "0.78rem" }} role="alert">{rangeError}</div>}

              <label className="agri-form-label">Barangay</label>
              {isFA ? (
                <div className="mb-3"><span className="agri-barangay-fixed"><MapPin size={14} aria-hidden="true" /> Barangay {user.barangayName}</span></div>
              ) : (
              <select className="form-select mb-3" value={barangay} onChange={(e) => setBarangay(e.target.value)} aria-label="Barangay">
                <option>All Barangays</option>
                {lists.barangays.map((b) => <option key={b.id} value={b.name}>{b.name}{b.isActive ? "" : " (deactivated)"}</option>)}
              </select>
              )}

              {farmerList && (
                <>
                  <label className="agri-form-label" htmlFor="report-sex">Sex</label>
                  <select id="report-sex" className="form-select mb-3" value={sex} onChange={(e) => setSex(e.target.value)}>
                    {SEX_OPTIONS.map((s) => <option key={s} value={s}>{s === "All" ? "All" : s}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>

          <button type="submit" className="btn btn-agri-primary w-100">Generate Report</button>
        </form>
      </div>

      <div className="agri-card" style={{ padding: 18 }}>
        <div className="agri-panel-header"><div style={{ fontWeight: 700 }}>Recent Reports</div></div>
        <div className="agri-table-wrap" ref={tableRef}>
          <table className="agri-table agri-table-cards">
            <thead><tr><th>Report Name</th><th>Type</th><th>Date Generated</th><th>Date Range</th><th></th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td>{r.dateGenerated}</td>
                  <td>{formatDate(r.dateFrom, "Any date")} – {formatDate(r.dateTo, "Any date")}</td>
                  <td>
                    <RowActionsMenu
                      label={`Actions for ${r.name}`}
                      actions={[
                        { key: "preview", label: "Open preview", icon: Eye, onClick: () => handlePreview(r) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
