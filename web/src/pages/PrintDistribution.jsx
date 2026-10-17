import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import PrintLayout, { KV } from "../components/print/PrintLayout.jsx";
import { useAutoPrint } from "../hooks/useAutoPrint.js";
import { getDistribution, listPrintBeneficiaries } from "../lib/api/distributions.js";
import { friendlyError } from "../lib/friendlyError.js";
import { isReleased, receiptsLabel } from "../lib/distributionStatus.js";

const STATUS_DOT = {
  Ongoing: "#f08c00",
  Distributed: "#3b82f6",
  Completed: "#2f9e44",
};

export default function PrintDistribution() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [distribution, setDistribution] = useState(null);
  const [beneficiaries, setBeneficiaries] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getDistribution(id), listPrintBeneficiaries(id)])
      .then(([dist, list]) => {
        setDistribution(dist);
        setBeneficiaries(list);
      })
      .catch((err) => setError(friendlyError(err, "Couldn't load this distribution.")));
  }, [id]);

  useAutoPrint(!!distribution && !!beneficiaries, searchParams.get("autoPrint") === "1");

  if (error) {
    return <div className="pr-page">Could not load this distribution: {error}</div>;
  }
  if (!distribution || !beneficiaries) {
    return <div className="pr-page">Loading…</div>;
  }

  const d = distribution;
  const eventDateLong = new Date(d.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const sameUnit = d.items.length > 0 && d.items.every((i) => i.unit === d.items[0].unit);
  const totalQty = d.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <PrintLayout title="Distribution Report" subtitle={`Distribution No. ${d.id} · ${eventDateLong}`}>
      <div className="pr-section">
        <div className="pr-section-label">Distribution Details</div>
        <div className="pr-kv-grid">
          <KV label="Distribution ID" value={d.id} />
          <KV label="Program" value={d.program} />
          <KV label="Date" value={d.date} />
          <KV label="Barangay" value={d.barangay} />
          <KV label="Venue" value={d.venue} />
          <KV label="Funding Source" value={d.fundingSource} />
          <KV label="Acknowledgement Receipts" value={receiptsLabel(d)} />
          <KV
            label="Status"
            value={
              <span className="pr-status">
                <span className="pr-status-dot" style={{ background: STATUS_DOT[d.status] ?? "#9aa89f" }} />
                {d.status}
              </span>
            }
          />
          <KV label="Total Beneficiaries" value={`${d.beneficiaries} farmers`} />
        </div>
      </div>

      <div className="pr-section">
        <div className="pr-section-label">Items Distributed</div>
        <table className="pr-items-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="pr-num pr-col-narrow">Quantity</th>
              <th className="pr-col-pad-left">Unit</th>
            </tr>
          </thead>
          <tbody>
            {d.items.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td className="pr-num">{item.quantity.toLocaleString()}</td>
                <td className="pr-col-pad-left">{item.unit}</td>
              </tr>
            ))}
            <tr className="pr-items-total">
              <td>Total</td>
              <td className="pr-num">{totalQty.toLocaleString()}</td>
              <td className="pr-col-pad-left">{sameUnit ? d.items[0].unit : ""}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <BeneficiaryList distribution={d} beneficiaries={beneficiaries} eventDateLong={eventDateLong} />
    </PrintLayout>
  );
}

// "09/30/2026": event_date is a plain YYYY-MM-DD string, so reformat it
// directly instead of going through Date (no time-zone day shifts).
function shortDate(isoDate) {
  const [y, m, d] = String(isoDate).split("-");
  return y && m && d ? `${m}/${d}/${y}` : "";
}

// The report's only signature block. It sits at the very end of the
// document (after the beneficiary list, or after the "no tagged
// beneficiaries" note) and never splits across pages — if it doesn't fit
// under the last row it moves to the next page whole.
function Signatures() {
  return (
    <div className="pr-signatures">
      <SignatureCol label="Prepared by" role="Administrative Staff" />
      <SignatureCol label="Checked by" role="Agricultural Extension Worker" />
      <SignatureCol label="Approved by" role="Municipal Agriculture Officer" />
    </div>
  );
}

// Page 2 onward: the masterlist of tagged farmers. Always starts on a new
// page (the shared print header repeats there via PrintLayout's thead); the
// table's own header row repeats on every page it continues onto, and rows
// never split across pages. Date Received is the distribution date once the
// items are released (Distributed or Completed), otherwise blank to be
// filled in by hand.
// The signature block follows the Total row (or the empty-list note).
function BeneficiaryList({ distribution: d, beneficiaries, eventDateLong }) {
  const farmerCount = new Set(beneficiaries.map((b) => b.farmerId)).size;
  const totalQty = beneficiaries.reduce((sum, b) => sum + b.quantity, 0);
  const sameUnit = beneficiaries.length > 0 && beneficiaries.every((b) => b.unit === beneficiaries[0].unit);
  const received = isReleased(d) ? shortDate(d.date) : "";

  return (
    <section className="pr-beneficiaries">
      <div className="pr-title-block">
        <div className="pr-title">List of Beneficiaries</div>
        <div className="pr-subtitle">{`Distribution No. ${d.id} · ${d.program} · ${eventDateLong}`}</div>
      </div>

      {beneficiaries.length > 0 ? (
        <table className="pr-items-table pr-beneficiary-table">
          <colgroup>
            <col className="pr-bcol-no" />
            <col className="pr-bcol-name" />
            <col className="pr-bcol-rsbsa" />
            <col className="pr-bcol-sex" />
            <col className="pr-bcol-commodity" />
            <col className="pr-bcol-qty" />
            <col className="pr-bcol-unit" />
            <col className="pr-bcol-date" />
            <col className="pr-bcol-sign" />
          </colgroup>
          <thead>
            <tr>
              <th className="pr-bnarrow">No.</th>
              <th>Name of Beneficiary</th>
              <th>RSBSA No.</th>
              <th className="pr-bnarrow">Sex</th>
              <th>Commodity</th>
              <th className="pr-num">Qty Received</th>
              <th className="pr-bnarrow">Unit</th>
              <th>Date Received</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>
            {beneficiaries.map((b, i) => (
              <tr key={b.claimId}>
                <td className="pr-bnarrow">{i + 1}</td>
                <td>{b.name}</td>
                <td className="pr-nowrap">{b.rsbsaNo}</td>
                <td className="pr-bnarrow">{b.sex}</td>
                <td>{b.commodity}</td>
                <td className="pr-num">{b.quantity.toLocaleString()}</td>
                <td className="pr-bnarrow">{b.unit}</td>
                <td className="pr-nowrap">{received}</td>
                <td />
              </tr>
            ))}
            <tr className="pr-items-total">
              <td colSpan={5}>Total: {farmerCount} {farmerCount === 1 ? "farmer" : "farmers"}</td>
              <td className="pr-num">{totalQty.toLocaleString()}</td>
              <td className="pr-bnarrow">{sameUnit ? beneficiaries[0].unit : ""}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="pr-no-beneficiaries">
          {d.beneficiaries > 0
            ? `No tagged beneficiaries. This record has ${d.beneficiaries} ${d.beneficiaries === 1 ? "farmer" : "farmers"} recorded without names.`
            : "No tagged beneficiaries for this distribution."}
        </p>
      )}

      <Signatures />
    </section>
  );
}

function SignatureCol({ label, role }) {
  return (
    <div className="pr-sig-col">
      <div className="pr-kv-label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="pr-sig-space" />
      <div className="pr-sig-line" />
      <div className="pr-sig-name">&nbsp;</div>
      <div className="pr-sig-role">{role}</div>
    </div>
  );
}
