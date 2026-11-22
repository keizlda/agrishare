import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import PrintLayout, { KV, Signatures } from "../components/print/PrintLayout.jsx";
import { computeCommodityStats } from "../data/mockData.js";
import { listFarmers } from "../lib/api/farmers.js";
import { listBeneficiaryReport, listDistributions } from "../lib/api/distributions.js";
import { listCommodities } from "../lib/api/commodities.js";
import { listSubmissions } from "../lib/api/cropValidation.js";
import { ASSOCIATION_STATUSES, ASSOCIATION_TYPES, listAssociationRequests } from "../lib/api/associationRequests.js";
import { listHarvestReports, totals as harvestTotals } from "../lib/api/harvest.js";
import { formatKg } from "../lib/allocation.js";
import { friendlyError } from "../lib/friendlyError.js";
import { acknowledgementLabel, dateReceived, isCompleted } from "../lib/distributionStatus.js";
import { formatDate, formatDateNumeric } from "../lib/dates.js";
import { formatItemsTotal, formatQuantity } from "../lib/quantity.js";

// Reports whose tables have 10 or more columns print landscape.
const WIDE_REPORTS = ["Beneficiary List", "Harvest Report"];

export default function PrintReport() {
  const [searchParams] = useSearchParams();
  const reportType = searchParams.get("type") || "Accomplishment Report";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const status = searchParams.get("status") || "All Status";
  const commodity = searchParams.get("commodity") || "All Commodities";
  const barangay = searchParams.get("barangay") || "All Barangays";

  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // includeDeleted: the Liquidation Report totals historical distributions
    // per commodity, so a since-deleted commodity must still get its row —
    // AccomplishmentReport's "types available" count filters back down to
    // active ones itself.
    Promise.all([listFarmers(), listDistributions(), listCommodities({ includeDeleted: true }), listBeneficiaryReport(), listSubmissions(), listAssociationRequests(), listHarvestReports()])
      .then(([farmers, distributions, commodities, beneficiaryClaims, submissions, associationRequests, harvests]) =>
        setData({ farmers, distributions, commodities, beneficiaryClaims, submissions, associationRequests, harvests }),
      )
      .catch((err) => setError(friendlyError(err, "Couldn't load this report.")));
  }, []);


  if (error) {
    return <div className="pr-message" role="alert">{error}</div>;
  }
  if (!data) {
    return <div className="pr-message">Loading…</div>;
  }

  const subtitleParts = [];
  if (dateFrom && dateTo) subtitleParts.push(`Date Range: ${formatDate(dateFrom)} to ${formatDate(dateTo)}`);
  else if (dateFrom) subtitleParts.push(`From: ${formatDate(dateFrom)}`);
  else if (dateTo) subtitleParts.push(`Through: ${formatDate(dateTo)}`);
  if (status !== "All Status") subtitleParts.push(`Status: ${status}`);
  if (barangay !== "All Barangays") subtitleParts.push(`Barangay: ${barangay}`);
  if (commodity !== "All Commodities") subtitleParts.push(`Commodity: ${commodity}`);

  const filters = { barangay, commodity, dateFrom, dateTo, status };

  return (
    <PrintLayout title={reportType} subtitle={subtitleParts.join(" · ") || undefined} backTo="/reports" landscape={WIDE_REPORTS.includes(reportType)}>
      {reportType === "Beneficiary List" && (
        <BeneficiaryList claims={data.beneficiaryClaims} distributions={data.distributions} filters={filters} />
      )}
      {reportType === "Distribution Summary" && <DistributionSummary distributions={data.distributions} filters={filters} />}
      {reportType === "Liquidation Report" && <LiquidationReport commodities={data.commodities} distributions={data.distributions} filters={filters} />}
      {reportType === "Accomplishment Report" && <AccomplishmentReport {...data} filters={filters} />}
      {reportType === "Attendance Sheet" && <AttendanceSheet claims={data.beneficiaryClaims} filters={filters} />}
      {reportType === "Harvest Report" && <HarvestReport harvests={data.harvests} filters={filters} />}
      <Signatures />
    </PrintLayout>
  );
}

// Case-insensitive on program/commodity (freeform text now, see Part 1) so
// "RCEF Seed Distribution" and "rcef seed distribution" aren't treated as
// different programs.
const ciEquals = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();

function filterClaims(claims, { barangay, commodity, dateFrom, dateTo, status }) {
  return claims
    .filter((c) => barangay === "All Barangays" || ciEquals(c.barangay, barangay))
    .filter((c) => commodity === "All Commodities" || ciEquals(c.commodity, commodity))
    .filter((c) => status === "All Status" || c.status === status)
    .filter((c) => !dateFrom || (c.eventDate ?? "") >= dateFrom)
    .filter((c) => !dateTo || (c.eventDate ?? "") <= dateTo);
}

function filterDistributions(distributions, { barangay, commodity, dateFrom, dateTo, status }) {
  return distributions
    .filter((d) => barangay === "All Barangays" || ciEquals(d.barangay, barangay))
    .filter((d) => !commodity || commodity === "All Commodities" || d.items.some((i) => ciEquals(i.name, commodity)))
    .filter((d) => status === "All Status" || d.status === status)
    .filter((d) => !dateFrom || (d.date ?? "") >= dateFrom)
    .filter((d) => !dateTo || (d.date ?? "") <= dateTo);
}

// Built from tagged distribution_claims rows (Phase 2), not the farmers
// table — a farmer only appears once per distribution they were actually
// tagged in, with the real quantity they were given, the distribution's
// status, and their acknowledgement (Acknowledged with the Date Received
// once the distribution is Completed, otherwise Pending).
// Older distributions recorded before per-farmer tagging only have a
// numeric headcount and no claims at all — those still get one summary row
// each (clearly marked as not individually tagged) instead of silently
// disappearing from the report.
function BeneficiaryList({ claims, distributions, filters }) {
  const rows = filterClaims(claims, filters);
  const untaggedRows = filterDistributions(distributions, filters).filter((d) => d.taggedBeneficiaryCount === 0 && d.beneficiaries > 0);
  const qty = (n, unit) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit && unit !== "kg" ? ` ${unit}` : ""}`;
  const kgTotal = rows.filter((c) => c.unit === "kg").reduce((sum, c) => sum + c.quantity, 0);

  return (
    <div className="pr-section">
      <table className="pr-items-table pr-dense-table">
        <colgroup>
          <col style={{ width: "13%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "8%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>RSBSA No.</th>
            <th>Full Name</th>
            <th>Barangay</th>
            <th>Commodity</th>
            <th>Type</th>
            <th className="pr-num">Farm Size (ha)</th>
            <th className="pr-num">Quantity (kg)</th>
            <th>Date</th>
            <th>Status</th>
            <th>Acknowledgement</th>
            <th>Date Received</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.claimId}>
              <td>{c.rsbsaNo}</td>
              <td>{c.firstName} {c.lastName}</td>
              <td>{c.barangay}</td>
              <td>{c.commodity}</td>
              <td>{c.typeName || "—"}</td>
              <td className="pr-num">{c.farmSize > 0 ? c.farmSize.toFixed(2) : "—"}</td>
              <td className="pr-num">{qty(c.quantity, c.unit)}</td>
              <td>{formatDateNumeric(c.eventDate)}</td>
              <td>{c.status}</td>
              <td>{acknowledgementLabel(c)}</td>
              <td>{dateReceived({ ...c, date: c.eventDate })}</td>
            </tr>
          ))}
          {untaggedRows.map((d) => (
            <tr key={`untagged-${d.id}`}>
              <td colSpan={2} className="agri-muted">{d.beneficiaries} beneficiaries (not individually tagged)</td>
              <td>{d.barangay}</td>
              <td>{d.items.map((i) => i.name).join(", ")}</td>
              <td>—</td>
              <td className="pr-num">—</td>
              <td className="pr-num">{d.items.reduce((sum, i) => sum + i.quantity, 0).toLocaleString()}</td>
              <td>{formatDateNumeric(d.date)}</td>
              <td>{d.status}</td>
              <td>{acknowledgementLabel(d)}</td>
              <td>{dateReceived(d)}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="pr-items-total">
              <td colSpan={6}>{rows.length.toLocaleString()} {rows.length === 1 ? "beneficiary" : "beneficiaries"}</td>
              <td className="pr-num">{kgTotal > 0 ? formatKg(kgTotal) : "—"}</td>
              <td colSpan={4} />
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && untaggedRows.length === 0 && (
        <div className="pr-empty" style={{ marginTop: 12 }}>No beneficiaries match these filters.</div>
      )}
    </div>
  );
}

function DistributionSummary({ distributions, filters }) {
  const rows = filterDistributions(distributions, filters);

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
              <td>{formatDateNumeric(d.date)}</td>
              <td>{d.program}</td>
              <td>{d.barangay}</td>
              <td className="pr-num">{d.taggedBeneficiaryCount > 0 ? d.taggedBeneficiaryCount : `${d.beneficiaries} (not tagged)`}</td>
              <td className="pr-num pr-col-pad-left">{formatItemsTotal(d.items)}</td>
              <td className="pr-col-pad-left">{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="pr-empty" style={{ marginTop: 12 }}>No matching distributions.</div>}
    </div>
  );
}

// RSBSA/Name/Commodity/Type/Qty/blank Signature — for farmers to sign as
// physical proof of receipt at the distribution site.
function AttendanceSheet({ claims, filters }) {
  const rows = filterClaims(claims, filters);

  return (
    <div className="pr-section">
      <table className="pr-items-table">
        <thead>
          <tr>
            <th>RSBSA No.</th>
            <th>Farmer Name</th>
            <th>Commodity</th>
            <th>Type</th>
            <th className="pr-num pr-col-pad-left">Qty</th>
            <th className="pr-col-pad-left">Signature</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.claimId}>
              <td>{c.rsbsaNo}</td>
              <td>{c.firstName} {c.lastName}</td>
              <td>{c.commodity}</td>
              <td>{c.typeName || "—"}</td>
              <td className="pr-num pr-col-pad-left">{c.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })} {c.unit}</td>
              <td className="pr-col-pad-left">&nbsp;</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="pr-empty" style={{ marginTop: 12 }}>No tagged beneficiaries match these filters.</div>}
    </div>
  );
}

// Only Completed distributions count (items released and signed for).
function LiquidationReport({ commodities, distributions, filters }) {
  const scoped = filterDistributions(distributions, filters).filter(isCompleted);
  const { totals } = computeCommodityStats(commodities, scoped);

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
              <td className="pr-num pr-col-pad-left">{formatQuantity(totals[c.name] ?? 0, c.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccomplishmentReport({ farmers, distributions, commodities, submissions, associationRequests, harvests = [], filters }) {
  // Distribution-activity figures respect the report's date/status/barangay
  // filters (this is the period being reported on); the farmer roster and
  // commodity catalog are current-state counts, not scoped to a period.
  // Only Completed distributions count as accomplished.
  const completed = filterDistributions(distributions, filters).filter(isCompleted);
  const totalQty = formatItemsTotal(completed.flatMap((d) => d.items));
  const active = farmers.filter((f) => f.status === "Active").length;
  // Validation is per proof-of-planting submission, not per farmer.
  const validatedSubmissions = submissions.filter((s) => s.status === "Validated").length;

  return (
    <div className="pr-section">
      <div className="pr-section-label">Accomplishment Summary</div>
      <div className="pr-kv-grid">
        <KV label="Total Registered Farmers" value={farmers.length} />
        <KV label="Active Farmers" value={active} />
        <KV label="Proof of Planting Validated" value={`${validatedSubmissions} of ${submissions.length} submissions`} />
        <KV label="Completed Distribution Activities" value={completed.length} />
        <KV label="Total Quantity Distributed" value={totalQty} />
        <KV label="Commodity Types Available" value={commodities.filter((c) => !c.deletedAt).length} />
        <KV label="Harvest Reported" value={harvestSummary(filterHarvests(harvests, { ...filters, status: "All Status", commodity: "All Commodities" }))} />
        <KV label="Harvest Verified by the MAO" value={harvestSummary(filterHarvests(harvests, { ...filters, status: "Verified", commodity: "All Commodities" }))} />
      </div>
      <AssociationRequestCounts requests={associationRequests} filters={filters} />
    </div>
  );
}

// The day a request was submitted, in Philippine time (YYYY-MM-DD), for the
// report's date range.
const manilaDate = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

// Association requests submitted in the report's date range, counted by
// type (rows) and status (columns). Cancelled requests aren't counted.
function AssociationRequestCounts({ requests = [], filters: { dateFrom, dateTo } }) {
  const inRange = requests.filter((r) => (!dateFrom || manilaDate(r.createdAt) >= dateFrom) && (!dateTo || manilaDate(r.createdAt) <= dateTo));
  const count = (type, status) => inRange.filter((r) => (!type || r.type === type) && (!status || r.statusKey === status)).length;
  return (
    <>
      <div className="pr-section-label" style={{ marginTop: 18 }}>Association Requests</div>
      <table className="pr-items-table">
        <thead>
          <tr>
            <th>Type</th>
            {ASSOCIATION_STATUSES.map((s) => <th key={s.value} className="pr-num">{s.label}</th>)}
            <th className="pr-num">Total</th>
          </tr>
        </thead>
        <tbody>
          {ASSOCIATION_TYPES.map((t) => (
            <tr key={t.value}>
              <td>{t.label}</td>
              {ASSOCIATION_STATUSES.map((s) => <td key={s.value} className="pr-num">{count(t.value, s.value)}</td>)}
              <td className="pr-num">{count(t.value)}</td>
            </tr>
          ))}
          <tr className="pr-items-total">
            <td>Total</td>
            {ASSOCIATION_STATUSES.map((s) => <td key={s.value} className="pr-num">{count(null, s.value)}</td>)}
            <td className="pr-num">{inRange.length}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}


// Harvest reports in the report's filters: harvest date range, barangay,
// crop (commodity) and status (Submitted / Verified / Returned).
function filterHarvests(harvests, { barangay, commodity, dateFrom, dateTo, status }) {
  return harvests
    .filter((h) => barangay === "All Barangays" || ciEquals(h.barangay, barangay))
    .filter((h) => commodity === "All Commodities" || ciEquals(h.commodityName, commodity))
    .filter((h) => status === "All Status" || h.status === status)
    .filter((h) => !dateFrom || (h.harvestDate ?? "") >= dateFrom)
    .filter((h) => !dateTo || (h.harvestDate ?? "") <= dateTo);
}

const fmt2 = (n) => (n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

// "12,400 kg from 5 reports (3.5 ha, 3,542.86 kg/ha)"
function harvestSummary(list) {
  const t = harvestTotals(list);
  if (!t.count) return "None";
  return `${formatKg(t.kg)} from ${t.count} ${t.count === 1 ? "report" : "reports"}${t.perHa != null ? ` (${fmt2(t.ha)} ha, ${fmt2(t.perHa)} kg/ha)` : ""}`;
}

// Harvest Report: one row per report (RSBSA No. first), then totals per
// crop / type. Kilograms only.
function HarvestReport({ harvests, filters }) {
  const rows = filterHarvests(harvests, filters).sort((a, b) => a.rsbsaNo.localeCompare(b.rsbsaNo) || (a.harvestDate ?? "").localeCompare(b.harvestDate ?? ""));
  const all = harvestTotals(rows);
  const byCrop = [...new Set(rows.map((r) => r.crop))].sort().map((crop) => ({ crop, ...harvestTotals(rows.filter((r) => r.crop === crop)) }));

  return (
    <div className="pr-section">
      <div className="pr-kv-grid">
        <KV label="Harvest Reports" value={all.count.toLocaleString()} />
        <KV label="Total Harvest" value={formatKg(all.kg)} />
        <KV label="Area Harvested" value={all.ha > 0 ? `${fmt2(all.ha)} ha` : "—"} />
        <KV label="Average Yield" value={all.perHa != null ? `${fmt2(all.perHa)} kg/ha` : "—"} />
      </div>
      <table className="pr-items-table pr-dense-table" style={{ marginTop: 14 }}>
        <colgroup>
          <col style={{ width: "15%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "6%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9.5%" }} />
          <col style={{ width: "9.5%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>RSBSA No.</th>
            <th>Farmer</th>
            <th>Barangay</th>
            <th>Crop / Type</th>
            <th>Season</th>
            <th className="pr-num">Area (ha)</th>
            <th className="pr-num">Harvest (kg)</th>
            <th className="pr-num">kg/ha</th>
            <th>Harvest Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td>{h.rsbsaNo}</td>
              <td>{h.farmerName}</td>
              <td>{h.barangay}</td>
              <td>{h.crop}</td>
              <td>{h.seasonLabel}</td>
              <td className="pr-num">{fmt2(h.areaHa)}</td>
              <td className="pr-num">{fmt2(h.yieldKg)}</td>
              <td className="pr-num">{fmt2(h.yieldPerHa)}</td>
              <td>{formatDateNumeric(h.harvestDate)}</td>
              <td>{h.status}</td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="pr-items-total">
              <td colSpan={5}>Total ({rows.length.toLocaleString()} {rows.length === 1 ? "report" : "reports"})</td>
              <td className="pr-num">{fmt2(all.ha)}</td>
              <td className="pr-num">{fmt2(all.kg)}</td>
              <td className="pr-num">{fmt2(all.perHa)}</td>
              <td colSpan={2} />
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && <div className="pr-empty" style={{ marginTop: 12 }}>No harvest reports match these filters.</div>}

      {byCrop.length > 1 && (
        <>
          <div className="pr-section-label" style={{ marginTop: 18 }}>By Crop / Type</div>
          <table className="pr-items-table">
            <thead>
              <tr>
                <th>Crop / Type</th>
                <th className="pr-num">Reports</th>
                <th className="pr-num">Area (ha)</th>
                <th className="pr-num">Harvest (kg)</th>
                <th className="pr-num">Average kg/ha</th>
              </tr>
            </thead>
            <tbody>
              {byCrop.map((c) => (
                <tr key={c.crop}>
                  <td>{c.crop}</td>
                  <td className="pr-num">{c.count}</td>
                  <td className="pr-num">{fmt2(c.ha)}</td>
                  <td className="pr-num">{fmt2(c.kg)}</td>
                  <td className="pr-num">{fmt2(c.perHa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
