import { useEffect, useState } from "react";
import { Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Eye, FileBarChart2, FileText, Package, Users } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { barangays, computeDistributionByCommodity, computeDistributionTrend, distributionTotalQty, reportTypes } from "../data/mockData.js";
import { listDistributions } from "../lib/api/distributions.js";
import { listFarmers } from "../lib/api/farmers.js";
import { listCommodities } from "../lib/api/commodities.js";

const PIE_COLORS = ["#2f9e44", "#3b82f6", "#f08c00", "#7048e8", "#e03131"];

// Generated-report history is a session convenience log (what got downloaded,
// when) rather than domain data from the paper's ERD, so it stays local —
// there's no tbl_Reports to persist it to server-side.
export default function Reports() {
  const [reports, setReports] = usePersistedState("agrishare_reports", []);
  const [distributions, setDistributions] = useState([]);
  const [farmers, setFarmers] = useState([]);
  const [commodities, setCommodities] = useState([]);

  useEffect(() => {
    listDistributions().then(setDistributions).catch(() => {});
    listFarmers().then(setFarmers).catch(() => {});
    listCommodities().then(setCommodities).catch(() => {});
  }, []);

  const { trend: distributionTrend } = computeDistributionTrend(distributions);
  const distributionByCommodity = computeDistributionByCommodity(commodities, distributions, 4);

  const [reportType, setReportType] = useState(reportTypes[0]);
  const [dateFrom, setDateFrom] = useState("2024-05-01");
  const [dateTo, setDateTo] = useState("2024-05-31");
  const [commodity, setCommodity] = useState("All Commodities");
  const [barangay, setBarangay] = useState("All Barangays");

  const totalQuantity = distributions.reduce((sum, d) => sum + distributionTotalQty(d), 0);

  function printUrl({ type, dateFrom, dateTo, commodity, barangay }, autoPrint) {
    const params = new URLSearchParams({ type, dateFrom, dateTo, commodity, barangay });
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
        commodity,
        barangay,
      },
      ...prev,
    ]);
    window.open(printUrl({ type: reportType, dateFrom, dateTo, commodity, barangay }, true), "_blank", "noopener,noreferrer");
  }

  function handlePreview(r) {
    window.open(printUrl({ type: r.type, dateFrom: r.dateFrom, dateTo: r.dateTo, commodity: r.commodity, barangay: r.barangay }, false), "_blank", "noopener,noreferrer");
  }

  function handleDownload(r) {
    window.open(printUrl({ type: r.type, dateFrom: r.dateFrom, dateTo: r.dateTo, commodity: r.commodity, barangay: r.barangay }, true), "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={Users} label="Total Farmers" value={farmers.length} sub="All registered farmers" color="green" />
        <StatCard icon={FileBarChart2} label="Total Distributions" value={distributions.length} sub="All time distributions" color="blue" />
        <StatCard icon={Package} label="Total Quantity" value={totalQuantity.toLocaleString()} sub="All commodities (kg)" color="purple" />
        <StatCard icon={FileText} label="Reports Generated" value={reports.length} sub="This month" color="orange" />
      </OverviewDrawer>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div className="agri-card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Distribution by Commodity</div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={distributionByCommodity} dataKey="value" nameKey="name" outerRadius={72} label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                {distributionByCommodity.map((entry, i) => (
                  <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--agri-border)", fontSize: 13 }} formatter={(v) => `${v.toLocaleString()} kg`} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="agri-card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Distribution Trend (2024)</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={distributionTrend}>
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6b7a70" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#6b7a70" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--agri-border)", fontSize: 13 }} formatter={(v) => `${v.toLocaleString()} kg`} />
              <Line type="monotone" dataKey="quantity" stroke="var(--agri-primary)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="agri-card" style={{ padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Generate Report</div>
          <form onSubmit={handleGenerate}>
            <label className="agri-form-label">Report Type</label>
            <select className="form-select mb-3" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {reportTypes.map((t) => <option key={t}>{t}</option>)}
            </select>

            <label className="agri-form-label">Date Range</label>
            <div className="d-flex gap-2 mb-3">
              <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <label className="agri-form-label">Commodity</label>
            <select className="form-select mb-3" value={commodity} onChange={(e) => setCommodity(e.target.value)}>
              <option>All Commodities</option>
              <option>Rice</option><option>Corn</option><option>Vegetables</option><option>Fertilizer</option>
            </select>

            <label className="agri-form-label">Barangay</label>
            <select className="form-select mb-3" value={barangay} onChange={(e) => setBarangay(e.target.value)}>
              <option>All Barangays</option>
              {barangays.map((b) => <option key={b}>{b}</option>)}
            </select>

            <button type="submit" className="btn btn-agri-primary w-100">Generate Report</button>
          </form>
        </div>
      </div>

      <div className="agri-card" style={{ padding: 18 }}>
        <div className="agri-panel-header"><div style={{ fontWeight: 700 }}>Recent Reports</div></div>
        <div className="agri-table-wrap">
          <table className="agri-table">
            <thead><tr><th>Report Name</th><th>Type</th><th>Date Generated</th><th>Date Range</th><th>Actions</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td>{r.dateGenerated}</td>
                  <td>{r.dateFrom} – {r.dateTo}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="agri-icon-btn" title="Preview" onClick={() => handlePreview(r)}><Eye size={14} /></button>
                      <button className="agri-icon-btn" title="Download" onClick={() => handleDownload(r)}><Download size={14} /></button>
                    </div>
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
