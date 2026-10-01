import { useEffect, useState } from "react";
import { Download, Eye } from "lucide-react";
import RowActionsMenu from "../components/ui/RowActionsMenu.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { barangays, reportTypes } from "../data/mockData.js";
import { listCommodities } from "../lib/api/commodities.js";

const STATUS_OPTIONS = ["All Status", "Scheduled", "Ongoing", "Completed", "Cancelled"];

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
  const [barangay, setBarangay] = useState("All Barangays");

  useEffect(() => {
    listCommodities()
      .then((rows) => setCommodityOptions(rows.filter((c) => c.status === "Active").map((c) => c.name)))
      .catch(() => {});
  }, []);

  function printUrl({ type, dateFrom, dateTo, status, commodity, barangay }, autoPrint) {
    const params = new URLSearchParams({ type, dateFrom, dateTo, status, commodity, barangay });
    if (autoPrint) params.set("autoPrint", "1");
    return `/print/reports?${params.toString()}`;
  }

  function handleGenerate(e) {
    e.preventDefault();
    const id = `RPT-${String(reports.length + 29).padStart(3, "0")}`;
    setReports((prev) => [
      {
        id,
        name: `${reportType} — ${commodity}`,
        type: reportType,
        dateGenerated: new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }),
        dateFrom,
        dateTo,
        status,
        commodity,
        barangay,
      },
      ...prev,
    ]);
    window.open(printUrl({ type: reportType, dateFrom, dateTo, status, commodity, barangay }, true), "_blank", "noopener,noreferrer");
  }

  function handlePreview(r) {
    window.open(printUrl({ type: r.type, dateFrom: r.dateFrom, dateTo: r.dateTo, status: r.status ?? "All Status", commodity: r.commodity, barangay: r.barangay }, false), "_blank", "noopener,noreferrer");
  }

  function handleDownload(r) {
    window.open(printUrl({ type: r.type, dateFrom: r.dateFrom, dateTo: r.dateTo, status: r.status ?? "All Status", commodity: r.commodity, barangay: r.barangay }, true), "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      <div className="agri-card agri-report-card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Generate Report</div>
        <form onSubmit={handleGenerate}>
          <div className="agri-report-form-grid">
            <div>
              <label className="agri-form-label">Report Type</label>
              <select className="form-select mb-3" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                {reportTypes.map((t) => <option key={t}>{t}</option>)}
              </select>

              <label className="agri-form-label">Commodity</label>
              <select className="form-select mb-3" value={commodity} onChange={(e) => setCommodity(e.target.value)}>
                <option>All Commodities</option>
                {commodityOptions.map((c) => <option key={c}>{c}</option>)}
              </select>

              <label className="agri-form-label">Status</label>
              <select className="form-select mb-3" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="agri-form-label">Date Range</label>
              <div className="agri-muted" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Leave blank to include every date.</div>
              <div className="d-flex gap-2 mb-3">
                <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>

              <label className="agri-form-label">Barangay</label>
              <select className="form-select mb-3" value={barangay} onChange={(e) => setBarangay(e.target.value)}>
                <option>All Barangays</option>
                {barangays.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-agri-primary w-100">Generate Report</button>
        </form>
      </div>

      <div className="agri-card" style={{ padding: 18 }}>
        <div className="agri-panel-header"><div style={{ fontWeight: 700 }}>Recent Reports</div></div>
        <div className="agri-table-wrap">
          <table className="agri-table">
            <thead><tr><th>Report Name</th><th>Type</th><th>Date Generated</th><th>Date Range</th><th></th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td>{r.dateGenerated}</td>
                  <td>{r.dateFrom || "Any date"} – {r.dateTo || "Any date"}</td>
                  <td>
                    <RowActionsMenu
                      label={`Actions for ${r.name}`}
                      actions={[
                        { key: "preview", label: "Preview", icon: Eye, onClick: () => handlePreview(r) },
                        { key: "download", label: "Download", icon: Download, onClick: () => handleDownload(r) },
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
