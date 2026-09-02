import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import PrintLayout, { KV } from "../components/print/PrintLayout.jsx";
import { useAutoPrint } from "../hooks/useAutoPrint.js";
import { getDistribution } from "../lib/api/distributions.js";

const STATUS_DOT = {
  Ongoing: "#f08c00",
  Completed: "#2f9e44",
  Scheduled: "#9aa89f",
};

export default function PrintDistribution() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [distribution, setDistribution] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getDistribution(id)
      .then(setDistribution)
      .catch((err) => setError(err.message));
  }, [id]);

  useAutoPrint(!!distribution, searchParams.get("autoPrint") === "1");

  if (error) {
    return <div className="pr-page">Could not load this distribution: {error}</div>;
  }
  if (!distribution) {
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
          <KV label="Acknowledgement Status" value={d.acknowledgementStatus} />
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

      <div className="pr-signatures">
        <SignatureCol label="Prepared by" role="Administrative Staff" />
        <SignatureCol label="Checked by" role="Agricultural Extension Worker" />
        <SignatureCol label="Approved by" role="Municipal Agriculture Officer" />
      </div>
    </PrintLayout>
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
