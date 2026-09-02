import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { getDistribution } from "../lib/api/distributions.js";
import maoSeal from "../assets/mao-seal.png";
import agrishareLogo from "../assets/agrishare-logo.svg";
import "./PrintDistribution.css";

const STATUS_DOT = {
  Ongoing: "#f08c00",
  Completed: "#2f9e44",
  Scheduled: "#9aa89f",
};

function EmptyValue() {
  return <span className="pr-empty">—</span>;
}

export default function PrintDistribution() {
  const { id } = useParams();
  const [distribution, setDistribution] = useState(null);
  const [error, setError] = useState("");
  const [logosLoaded, setLogosLoaded] = useState(0);
  const printedRef = useRef(false);

  useEffect(() => {
    getDistribution(id)
      .then(setDistribution)
      .catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    if (!distribution || printedRef.current) return;
    // Auto-open the print dialog once loaded — wait for both logos (or give
    // up after 2s so a slow/broken image never blocks printing entirely).
    if (logosLoaded >= 2) {
      printedRef.current = true;
      setTimeout(() => window.print(), 150);
      return;
    }
    const fallback = setTimeout(() => {
      if (!printedRef.current) {
        printedRef.current = true;
        window.print();
      }
    }, 2000);
    return () => clearTimeout(fallback);
  }, [distribution, logosLoaded]);

  if (error) {
    return <div className="pr-page">Could not load this distribution: {error}</div>;
  }
  if (!distribution) {
    return <div className="pr-page">Loading…</div>;
  }

  const d = distribution;
  const generatedAt = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const eventDateLong = new Date(d.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const sameUnit = d.items.length > 0 && d.items.every((i) => i.unit === d.items[0].unit);
  const totalQty = d.items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="pr-page">
      <div className="pr-toolbar pr-no-print">
        <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => window.print()}>
          <Printer size={15} /> Print / Save as PDF
        </button>
      </div>

      <table className="pr-shell">
        <thead>
          <tr>
            <td>
              <div className="pr-header-row">
                <img
                  src={maoSeal}
                  alt="Municipal Agriculture Office seal"
                  className="pr-logo"
                  onLoad={() => setLogosLoaded((n) => n + 1)}
                  onError={() => setLogosLoaded((n) => n + 1)}
                />
                <div className="pr-header-center">
                  <div className="pr-header-line">Republic of the Philippines</div>
                  <div className="pr-header-line">Municipality of Labangan, Zamboanga del Sur</div>
                  <div className="pr-header-office">MUNICIPAL AGRICULTURE OFFICE</div>
                  <div className="pr-header-line">Barangay Langapud</div>
                </div>
                <img
                  src={agrishareLogo}
                  alt="AgriShare logo"
                  className="pr-logo"
                  onLoad={() => setLogosLoaded((n) => n + 1)}
                  onError={() => setLogosLoaded((n) => n + 1)}
                />
              </div>
              <hr className="pr-rule" />
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="pr-title-block">
                <div className="pr-title">Distribution Report</div>
                <div className="pr-subtitle">Distribution No. {d.id} · {eventDateLong}</div>
              </div>

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
                      <th className="pr-num">Quantity</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((item) => (
                      <tr key={item.name}>
                        <td>{item.name}</td>
                        <td className="pr-num">{item.quantity.toLocaleString()}</td>
                        <td>{item.unit}</td>
                      </tr>
                    ))}
                    <tr className="pr-items-total">
                      <td>Total</td>
                      <td className="pr-num">{totalQty.toLocaleString()}</td>
                      <td>{sameUnit ? d.items[0].unit : ""}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="pr-signatures">
                <SignatureCol label="Prepared by" role="Administrative Staff" />
                <SignatureCol label="Checked by" role="Agricultural Extension Worker" />
                <SignatureCol label="Approved by" role="Municipal Agriculture Officer" />
              </div>

              <div className="pr-footer">
                <span>Generated via AgriShare · {generatedAt}</span>
                <span>Page 1</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div className="pr-kv-row">
      <div className="pr-kv-label">{label}</div>
      <div className="pr-kv-value">{value || <EmptyValue />}</div>
    </div>
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
