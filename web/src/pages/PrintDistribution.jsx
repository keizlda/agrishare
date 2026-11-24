import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PrintLayout, { KV, Signatures } from "../components/print/PrintLayout.jsx";
import { getDistribution, listPrintBeneficiaries } from "../lib/api/distributions.js";
import { friendlyError } from "../lib/friendlyError.js";
import { acknowledgementLabel, dateReceived } from "../lib/distributionStatus.js";
import { formatDate, formatDateLong } from "../lib/dates.js";
import { formatKg } from "../lib/allocation.js";

const STATUS_DOT = {
  Ongoing: "#f08c00",
  Completed: "#2f9e44",
};

const hectares = (n) => (n > 0 ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

export default function PrintDistribution() {
  const { id } = useParams();
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

  if (error) {
    return <div className="pr-message" role="alert">{error}</div>;
  }
  if (!distribution || !beneficiaries) {
    return <div className="pr-message">Loading…</div>;
  }

  const d = distribution;
  const eventDateLong = formatDateLong(d.date);
  const sameUnit = d.items.length > 0 && d.items.every((i) => i.unit === d.items[0].unit);
  const totalQty = d.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <PrintLayout title="Distribution Report" subtitle={`Distribution No. ${d.id} · ${eventDateLong}`} backTo="/distributions" barangayLine={d.barangay ? `Barangay ${d.barangay}` : ""}>
      <div className="pr-section">
        <div className="pr-section-label">Distribution Details</div>
        <div className="pr-kv-grid">
          <KV label="Distribution ID" value={d.id} />
          <KV label="Program" value={d.program} />
          <KV label="Date" value={formatDate(d.date)} />
          <KV label="Barangay" value={d.barangay} />
          <KV label="Venue" value={d.venue} />
          <KV label="Funding Source" value={d.fundingSource} />
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
          {d.allocationKg != null && <KV label="Allocation Used" value={`${formatKg(totalQty)} of ${formatKg(d.allocationKg)}`} />}
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

// Page 2 onward: the masterlist of tagged farmers, RSBSA No. first. Each
// farmer's Acknowledgement is "Acknowledged" once the distribution is
// Completed, with the completion date as Date Received; while Ongoing it
// reads "Pending" and the date is left blank.
function BeneficiaryList({ distribution: d, beneficiaries, eventDateLong }) {
  const farmerCount = new Set(beneficiaries.map((b) => b.farmerId)).size;
  const totalQty = beneficiaries.reduce((sum, b) => sum + b.quantity, 0);
  const sizes = new Map(beneficiaries.map((b) => [b.farmerId, b.farmSize || 0]));
  const totalHectares = Math.round([...sizes.values()].reduce((sum, n) => sum + n, 0) * 100) / 100;
  const sameUnit = beneficiaries.length > 0 && beneficiaries.every((b) => b.unit === beneficiaries[0].unit);
  const acknowledgement = acknowledgementLabel(d);
  const received = dateReceived(d);

  return (
    <section className="pr-beneficiaries">
      <div className="pr-title-block">
        <div className="pr-title">List of Beneficiaries</div>
        <div className="pr-subtitle">{`Distribution No. ${d.id} · ${d.program} · ${eventDateLong}`}</div>
      </div>

      {beneficiaries.length > 0 ? (
        <table className="pr-items-table pr-beneficiary-table">
          <colgroup>
            <col className="pr-bcol-rsbsa" />
            <col className="pr-bcol-name" />
            <col className="pr-bcol-sex" />
            <col className="pr-bcol-commodity" />
            <col className="pr-bcol-farm" />
            <col className="pr-bcol-qty" />
            <col className="pr-bcol-unit" />
            <col className="pr-bcol-ack" />
            <col className="pr-bcol-date" />
            <col className="pr-bcol-sign" />
          </colgroup>
          <thead>
            <tr>
              <th>RSBSA No.</th>
              <th>Name of Beneficiary</th>
              <th className="pr-bnarrow">Sex</th>
              <th>Commodity</th>
              <th className="pr-num">Farm Size (ha)</th>
              <th className="pr-num">Qty Received</th>
              <th className="pr-bnarrow">Unit</th>
              <th>Acknow&shy;ledgement</th>
              <th>Date Received</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>
            {beneficiaries.map((b) => (
              <tr key={b.claimId}>
                <td className="pr-nowrap">{b.rsbsaNo}</td>
                <td>{b.name}</td>
                <td className="pr-bnarrow">{b.sex}</td>
                <td>{b.commodity}</td>
                <td className="pr-num">{hectares(b.farmSize)}</td>
                <td className="pr-num">{b.quantity.toLocaleString()}</td>
                <td className="pr-bnarrow">{b.unit}</td>
                <td className="pr-nowrap">{acknowledgement}</td>
                <td className="pr-nowrap">{received}</td>
                <td />
              </tr>
            ))}
            <tr className="pr-items-total">
              <td colSpan={4}>Total: {farmerCount} {farmerCount === 1 ? "farmer" : "farmers"}</td>
              <td className="pr-num">{hectares(totalHectares)}</td>
              <td className="pr-num">{totalQty.toLocaleString()}</td>
              <td className="pr-bnarrow">{sameUnit ? beneficiaries[0].unit : ""}</td>
              <td colSpan={3} />
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

