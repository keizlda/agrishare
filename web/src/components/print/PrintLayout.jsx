import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Printer, X } from "lucide-react";
import maoSeal from "../../assets/mao-seal-print.png";
import "./print.css";
import { buildPage, planPages } from "./paginate.js";

const SEAL_LOAD_TIMEOUT_MS = 3000;
const MM = 96 / 25.4; // CSS px per millimetre

// Paper sizes. The margins are the printed page margins, kept inside each
// sheet (the browser's own page margin is 0, so it prints no header/footer).
const PAPERS = {
  a4: { label: "A4", css: "A4", width: 210, height: 297 },
  letter: { label: "Letter", css: "letter", width: 215.9, height: 279.4 },
};
const MARGIN = { top: 20, bottom: 20, left: 18, right: 18 };
const PAPER_KEY = "agrishare_print_paper";

function readPaper() {
  try {
    const saved = localStorage.getItem(PAPER_KEY);
    return PAPERS[saved] ? saved : "a4";
  } catch {
    return "a4";
  }
}

// Shared shell for every printable page (Distribution Report, Reports page
// reports): a toolbar (Back/Close, paper size, Print / Save as PDF) above a
// document viewer that shows each printed page as its own white sheet,
// exactly where it will break when printed. Nothing prints automatically —
// the print dialog opens only from "Print / Save as PDF".
//
// Every page repeats the header (seal, the four institutional lines, the
// green rule); the report title appears once, on page 1. There is no page
// footer. `backTo`: where Back goes when the page wasn't opened in its own
// tab.
export default function PrintLayout({ title, subtitle, backTo = "/", children }) {
  const [paperKey, setPaperKey] = useState(readPaper);
  const paper = PAPERS[paperKey];
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const measureRef = useRef(null);
  const sheetsRef = useRef(null);
  const viewerRef = useRef(null);
  const plansRef = useRef([]);

  const sheetWidth = paper.width * MM;
  const contentWidth = (paper.width - MARGIN.left - MARGIN.right) * MM;
  const contentHeight = (paper.height - MARGIN.top - MARGIN.bottom) * MM;

  function choosePaper(key) {
    setPaperKey(key);
    try {
      localStorage.setItem(PAPER_KEY, key);
    } catch {
      // Private window: the choice just isn't remembered.
    }
  }

  // Lay the report out once (hidden) at this paper's width and cut it into
  // pages. Runs again when the paper size or the report changes.
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;
    const header = root.querySelector("[data-pr-header]");
    const flow = root.querySelector("[data-pr-flow]");
    const headerHeight = flow.getBoundingClientRect().top - header.getBoundingClientRect().top;
    plansRef.current = planPages(flow, contentHeight - headerHeight);
    setPageCount(plansRef.current.length);
  }, [paperKey, contentHeight, title, subtitle, children]);

  // Fill each sheet with its page.
  useLayoutEffect(() => {
    const root = measureRef.current;
    const sheets = sheetsRef.current;
    if (!root || !sheets) return;
    const header = root.querySelector("[data-pr-header]");
    const flow = root.querySelector("[data-pr-flow]");
    [...sheets.querySelectorAll("[data-pr-sheet-body]")].forEach((body, i) => {
      const atoms = plansRef.current[i] ?? [];
      const head = body.previousElementSibling;
      head.replaceChildren(header.cloneNode(true));
      buildPage(body, flow, atoms);
    });
  }, [pageCount, paperKey, title, subtitle, children]);

  // Narrow windows: shrink the sheets to fit (screen only; print is 1:1).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;
    const fit = () => setScale(Math.min(1, (viewer.clientWidth - 32) / sheetWidth));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, [sheetWidth]);

  // Printing waits for the seal to be decoded so it can't come out blank (a
  // timeout keeps a broken image from blocking print forever).
  useEffect(() => {
    const originalPrint = window.print;
    const sealReady = new Promise((resolve) => {
      const img = new Image();
      img.src = maoSeal;
      img.decode().then(resolve, resolve);
      setTimeout(resolve, SEAL_LOAD_TIMEOUT_MS);
    });
    window.print = () => {
      sealReady.then(() => originalPrint.call(window));
    };
    return () => {
      window.print = originalPrint;
    };
  }, []);

  // Opened in its own tab: Close it. Otherwise: Back.
  const ownTab = typeof window !== "undefined" && window.history.length <= 1;
  const leave = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.close();
    // A tab the browser won't let a page close: go back into the app.
    setTimeout(() => window.location.assign(backTo), 250);
  }, [backTo]);

  return (
    <div className="pr-app" data-paper={paperKey}>
      <style>{`@page { size: ${paper.css} portrait; margin: 0; }`}</style>

      <header className="pr-toolbar" aria-label="Print preview">
        <button type="button" className="btn btn-outline-secondary pr-toolbar-btn" onClick={leave}>
          {ownTab ? <X size={15} /> : <ArrowLeft size={15} />} {ownTab ? "Close" : "Back"}
        </button>
        <div className="pr-toolbar-title" title={title}>
          {title}
          <span className="pr-toolbar-pages">{pageCount ? ` · ${pageCount} ${pageCount === 1 ? "page" : "pages"}` : ""}</span>
        </div>
        <div className="pr-paper-switch" role="radiogroup" aria-label="Paper size">
          {Object.entries(PAPERS).map(([key, p]) => (
            <button key={key} type="button" role="radio" aria-checked={paperKey === key} className={paperKey === key ? "active" : ""} onClick={() => choosePaper(key)}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-agri-primary pr-toolbar-btn" onClick={() => window.print()} disabled={!pageCount}>
          <Printer size={15} /> Print / Save as PDF
        </button>
      </header>

      <main className="pr-viewer" ref={viewerRef}>
        {!pageCount && <div className="pr-preparing">Preparing pages…</div>}
        <div className="pr-sheets" ref={sheetsRef} style={{ zoom: scale }}>
          {Array.from({ length: pageCount }, (_, i) => (
            <article
              key={`${paperKey}-${i}`}
              className="pr-sheet"
              aria-label={`Page ${i + 1} of ${pageCount}`}
              style={{
                width: `${paper.width}mm`,
                height: `${paper.height}mm`,
                padding: `${MARGIN.top}mm ${MARGIN.right}mm ${MARGIN.bottom}mm ${MARGIN.left}mm`,
              }}
            >
              <div data-pr-sheet-head />
              <div data-pr-sheet-body />
            </article>
          ))}
        </div>
      </main>

      {/* The report laid out once at the paper's content width, hidden: the
          source the pages are measured and copied from. */}
      <div className="pr-measure" ref={measureRef} style={{ width: `${contentWidth}px` }} aria-hidden="true">
        <div data-pr-header>
          <div className="pr-header">
            <img src={maoSeal} alt="Department of Agriculture seal" className="pr-seal" />
            <div className="pr-header-text">
              <div className="pr-header-line">Republic of the Philippines</div>
              <div className="pr-header-line">Municipality of Labangan, Zamboanga del Sur</div>
              <div className="pr-header-office">MUNICIPAL AGRICULTURE OFFICE</div>
              <div className="pr-header-line">Barangay Langapud</div>
            </div>
          </div>
          <hr className="pr-rule" />
        </div>
        <div data-pr-flow className="pr-flow">
          <div className="pr-title-block">
            <div className="pr-title">{title}</div>
            {subtitle && <div className="pr-subtitle">{subtitle}</div>}
          </div>
          {children}
        </div>
      </div>
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
