import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PrintLayout, { KV } from "../components/print/PrintLayout.jsx";
import { useAutoPrint } from "../hooks/useAutoPrint.js";
import { computeCommodityStats, distributionTotalQty } from "../data/mockData.js";
import { listFarmers } from "../lib/api/farmers.js";
import { listBeneficiaryReport, listDistributions } from "../lib/api/distributions.js";
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
    // includeDeleted: the Liquidation Report totals historical distributions
    // per commodity, so a since-deleted commodity must still get its row —
    // AccomplishmentReport's "types available" count filters back down to
    // active ones itself.
    Promise.all([listFarmers(), listDistributions(), listCommodities({ includeDeleted: true }), listBeneficiaryReport()])
      .then(([farmers, distributions, commodities, beneficiaryClaims]) => setData({ farmers, distributions, commodities, beneficiaryClaims }))
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
      {reportType === "Beneficiary List" && (
        <BeneficiaryList claims={data.beneficiaryClaims} barangay={barangay} commodity={commodity} dateFrom={dateFrom} dateTo={dateTo} />
      )}
      {reportType === "Distribution Summary" && <DistributionSummary distributions={data.distributions} barangay={barangay} />}
      {reportType === "Liquidation Report" && <LiquidationReport commodities={data.commodities} distributions={data.distributions} />}
      {reportType === "Accomplishment Report" && <AccomplishmentReport {...data} />}
      {reportType === "Attendance Sheet" && (
        <AttendanceSheet claims={data.beneficiaryClaims} barangay={barangay} commodity={commodity} dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </PrintLayout>
  );
}

function filterClaims(claims, { barangay, commodity, dateFrom, dateTo }) {
  return claims
    .filter((c) => barangay === "All Barangays" || c.barangay === barangay)
    .filter((c) => commodity === "All Commodities" || c.commodity === commodity)
    .filter((c) => !dateFrom || (c.eventDate ?? "") >= dateFrom)
    .filter((c) => !dateTo || (c.eventDate ?? "") <= dateTo);
}

// Built from tagged distribution_claims rows (Phase 2), not the farmers
// table — a farmer only appears once per distribution they were actually
// tagged in, with the real quantity/acknowledgement they were given.
function BeneficiaryList({ claims, barangay, commodity, dateFrom, dateTo }) {
  const rows = filterClaims(claims, { barangay, commodity, dateFrom, dateTo });

  return (
    <div className="pr-section">
      <table className="pr-items-table">
        <thead>
          <tr>
            <th>RSBSA No.</th>
            <th>Full Name</th>
            <th>Barangay</th>
            <th>Commodity</th>
            <th>Date</th>
            <th className="pr-num pr-col-pad-left">Qty</th>
            <th className="pr-col-pad-left">Acknowledgement</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.claimId}>
              <td>{c.rsbsaNo}</td>
              <td>{c.firstName} {c.lastName}</td>
              <td>{c.barangay}</td>
              <td>{c.commodity}</td>
              <td>{c.eventDate}</td>
              <td className="pr-num pr-col-pad-left">{c.quantity.toLocaleString()}</td>
              <td className="pr-col-pad-left">{c.acknowledgementStatus}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="pr-empty" style={{ marginTop: 12 }}>No tagged beneficiaries match these filters.</div>}
    </div>
  );
}

function DistributionSummary({ distributions, barangay }) {
  const rows = distributions.filter((d) => barangay === "All Barangays" || d.barangay === barangay);

  return (
    <div className="pr-section">
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
              <td className="pr-num">{d.taggedBeneficiaryCount > 0 ? d.taggedBeneficiaryCount : `${d.beneficiaries} (not tagged)`}</td>
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

// No./Name/RSBSA/Commodity/Qty/blank Signature — for farmers to sign as
// physical proof of receipt at the distribution site.
function AttendanceSheet({ claims, barangay, commodity, dateFrom, dateTo }) {
  const rows = filterClaims(claims, { barangay, commodity, dateFrom, dateTo });

  return (
    <div className="pr-section">
      <table className="pr-items-table">
        <thead>
          <tr>
            <th>No.</th>
            <th>Farmer Name</th>
            <th>RSBSA No.</th>
            <th>Commodity</th>
            <th className="pr-num pr-col-pad-left">Qty</th>
            <th className="pr-col-pad-left">Signature</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            <tr key={c.claimId}>
              <td>{i + 1}</td>
              <td>{c.firstName} {c.lastName}</td>
              <td>{c.rsbsaNo}</td>
              <td>{c.commodity}</td>
              <td className="pr-num pr-col-pad-left">{c.quantity.toLocaleString()}</td>
              <td className="pr-col-pad-left">&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="pr-empty" style={{ marginTop: 12 }}>No tagged beneficiaries match these filters.</div>}
    </div>
  );
}

function LiquidationReport({ commodities, distributions }) {
  const { totals } = computeCommodityStats(commodities, distributions);

  return (
    <div className="pr-section">
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
        <KV label="Commodity Types Available" value={commodities.filter((c) => !c.deletedAt).length} />
      </div>
    </div>
  );
}
