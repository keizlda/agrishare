import { useMemo } from "react";
import { Printer } from "lucide-react";
import maoSeal from "../../assets/mao-seal.png";
import "./print.css";

// Shared shell for every printable route: centered institutional header
// (seal above the text) repeating on every printed page via the
// <table><thead> trick (the standard cross-browser way to do this without a
// PDF library), a title block, then whatever the page passes as children.
//
// The printed footer ("Generated via AgriShare · <time>" left, "Page X of Y"
// right) lives in @page margin boxes, the only place CSS can render live page
// counters. They're emitted through an inline <style> so the timestamp is real
// data, not a static string. The in-flow .pr-footer below is the on-screen
// stand-in and is hidden when printing.
export default function PrintLayout({ title, subtitle, children }) {
  const generatedAt = useMemo(() => new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }), []);

  return (
    <div className="pr-page">
      <style>{`
        @page {
          @bottom-left { content: "Generated via AgriShare \\00B7  ${generatedAt}"; }
          @bottom-center { content: ""; }
          @bottom-right { content: "Page " counter(page) " of " counter(pages); }
        }
      `}</style>

      <div className="pr-toolbar pr-no-print">
        <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => window.print()}>
          <Printer size={15} /> Print / Save as PDF
        </button>
      </div>

      <table className="pr-shell">
        <thead>
          <tr>
            <td>
              <div className="pr-header">
                <img src={maoSeal} alt="Municipal Agriculture Office seal" className="pr-logo" />
                <div className="pr-header-line">Republic of the Philippines</div>
                <div className="pr-header-line">Municipality of Labangan, Zamboanga del Sur</div>
                <div className="pr-header-office">MUNICIPAL AGRICULTURE OFFICE</div>
                <div className="pr-header-line">Barangay Langapud</div>
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
                <span>Generated via AgriShare · {generatedAt}</span>
                <span>Page numbers are added when printed</span>
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
