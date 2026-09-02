import { Printer } from "lucide-react";
import maoSeal from "../../assets/mao-seal.png";
import agrishareLogo from "../../assets/agrishare-logo.svg";
import "./print.css";

// Shared shell for every printable route: seal + centered institutional
// header + AgriShare logo, repeating on every printed page via the
// <table><thead> trick (the standard cross-browser way to do this without
// a PDF library), a title block, then whatever the page passes as children,
// then a footer with the generation timestamp.
export default function PrintLayout({ title, subtitle, footerNote, children }) {
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
                <img src={maoSeal} alt="Municipal Agriculture Office seal" className="pr-logo" />
                <div className="pr-header-center">
                  <div className="pr-header-line">Republic of the Philippines</div>
                  <div className="pr-header-line">Municipality of Labangan, Zamboanga del Sur</div>
                  <div className="pr-header-office">MUNICIPAL AGRICULTURE OFFICE</div>
                  <div className="pr-header-line">Barangay Langapud</div>
                </div>
                <img src={agrishareLogo} alt="AgriShare logo" className="pr-logo" />
              </div>
              <hr className="pr-rule" />
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="pr-title-block">
                <div className="pr-title">{title}</div>
                {subtitle && <div className="pr-subtitle">{subtitle}</div>}
              </div>

              {children}

              <div className="pr-footer">
                <span>Generated via AgriShare · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                <span>{footerNote ?? "Page 1"}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function KV({ label, value }) {
  return (
    <div className="pr-kv-row">
      <div className="pr-kv-label">{label}</div>
      <div className="pr-kv-value">{value ?? <EmptyValue />}</div>
    </div>
  );
}

export function EmptyValue() {
  return <span className="pr-empty">—</span>;
}
