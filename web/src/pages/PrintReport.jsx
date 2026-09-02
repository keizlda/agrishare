import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PrintLayout, { KV } from "../components/print/PrintLayout.jsx";
import { useAutoPrint } from "../hooks/useAutoPrint.js";
import { computeCommodityStats, distributionTotalQty } from "../data/mockData.js";
import { listFarmers } from "../lib/api/farmers.js";
import { listDistributions } from "../lib/api/distributions.js";
import { listCommodities } from "../lib/api/commodities.js";

export default function PrintReport() {
  const [searchParams] = useSearchParams();
  const reportType = searchParams.get("type") || "Accomplishment Report";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const commodity = searchParams.get("commodity") || "All Commodities";
  const barangay = searchParams.get("barangay") || "All Barangays";

  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([listFarmers(), listDistributions(), listCommodities()])
      .then(([farmers, distributions, commodities]) => setData({ farmers, distributions, commodities }))
      .catch((err) => setError(err.message));
  }, []);

  useAutoPrint(!!data, searchParams.get("autoPrint") === "1");

  if (error) {
    return <div className="pr-page">Could not load this report: {error}</div>;
  }
  if (!data) {
    return <div className="pr-page">Loading…</div>;
  }

  const subtitleParts = [];
  if (dateFrom && dateTo) subtitleParts.push(`Date Range: ${dateFrom} to ${dateTo}`);
  if (barangay !== "All Barangays") subtitleParts.push(`Barangay: ${barangay}`);
  if (commodity !== "All Commodities") subtitleParts.push(`Commodity: ${commodity}`);

  return (
    <PrintLayout title={reportType} subtitle={subtitleParts.join(" · ") || undefined}>
      {reportType === "Beneficiary List" && <BeneficiaryList farmers={data.farmers} barangay={barangay} commodity={commodity} />}
      {reportType === "Distribution Summary" && <DistributionSummary distributions={data.distributions} barangay={barangay} />}
      {reportType === "Liquidation Report" && <LiquidationReport commodities={data.commodities} distributions={data.distributions} />}
      {reportType === "Accomplishment Report" && <AccomplishmentReport {...data} />}
    </PrintLayout>
  );
}

function BeneficiaryList({ farmers, barangay, commodity }) {
  const rows = farmers
    .filter((f) => barangay === "All Barangays" || f.barangay === barangay)
    .filter((f) => commodity === "All Commodities" || f.commodity === commodity);

  return (
    <div className="pr-section">
      <div className="pr-section-label">Beneficiary List</div>
      <table className="pr-items-table">
        <thead>
          <tr>
            <th>RSBSA No.</th>
            <th>Full Name</th>
            <th>Barangay</th>
            <th>Commodity</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td>{f.rsbsaNo}</td>
              <td>{f.firstName} {f.lastName}</td>
              <td>{f.barangay}</td>
              <td>{f.commodity}</td>
              <td>{f.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="pr-empty" style={{ marginTop: 12 }}>No matching farmers.</div>}
    </div>
  );
}

function DistributionSummary({ distributions, barangay }) {
  const rows = distributions.filter((d) => barangay === "All Barangays" || d.barangay === barangay);

  return (
    <div className="pr-section">
      <div className="pr-section-label">Distribution Summary</div>
      <table className="pr-items-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Date</th>
            <th>Program</th>
            <th>Barangay</th>
            <th className="pr-num">Beneficiaries</th>
            <th className="pr-num pr-col-pad-left">Quantity</th>
            <th className="pr-col-pad-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>{d.id}</td>
              <td>{d.date}</td>
              <td>{d.program}</td>
              <td>{d.barangay}</td>
              <td className="pr-num">{d.beneficiaries}</td>
              <td className="pr-num pr-col-pad-left">{distributionTotalQty(d).toLocaleString()} kg</td>
              <td className="pr-col-pad-left">{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="pr-empty" style={{ marginTop: 12 }}>No matching distributions.</div>}
    </div>
  );
}

function LiquidationReport({ commodities, distributions }) {
  const { totals } = computeCommodityStats(commodities, distributions);

  return (
    <div className="pr-section">
      <div className="pr-section-label">Liquidation Report</div>
      <table className="pr-items-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Category</th>
            <th className="pr-num pr-col-pad-left">Total Distributed</th>
          </tr>
        </thead>
        <tbody>
          {commodities.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.name}</td>
              <td>{c.category}</td>
              <td className="pr-num pr-col-pad-left">{(totals[c.name] ?? 0).toLocaleString()} kg</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccomplishmentReport({ farmers, distributions, commodities }) {
  const totalQty = distributions.reduce((sum, d) => sum + distributionTotalQty(d), 0);
  const active = farmers.filter((f) => f.status === "Active").length;
  const validated = farmers.filter((f) => f.validationStatus === "Validated").length;

  return (
    <div className="pr-section">
      <div className="pr-section-label">Accomplishment Summary</div>
      <div className="pr-kv-grid">
        <KV label="Total Registered Farmers" value={farmers.length} />
        <KV label="Active Farmers" value={active} />
        <KV label="Validated Farmers" value={`${validated} (${Math.round((validated / (farmers.length || 1)) * 100)}%)`} />
        <KV label="Total Distribution Activities" value={distributions.length} />
        <KV label="Total Quantity Distributed" value={`${totalQty.toLocaleString()} kg`} />
        <KV label="Commodity Types Available" value={commodities.length} />
      </div>
    </div>
  );
}
