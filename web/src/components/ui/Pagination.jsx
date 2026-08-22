import { ChevronLeft, ChevronRight } from "lucide-react";

function getPageNumbers(page, totalPages) {
  const pages = new Set([1, totalPages, page, page - 1, page + 1]);
  return [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
}

export default function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const pageNumbers = getPageNumbers(page, totalPages);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 14 }}>
      <button className="agri-icon-btn" disabled={page === 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
        <ChevronLeft size={15} />
      </button>

      {pageNumbers.map((p, i) => {
        const prev = pageNumbers[i - 1];
        const showEllipsis = prev !== undefined && p - prev > 1;
        return (
          <span key={p} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {showEllipsis && <span className="agri-muted" style={{ padding: "0 2px" }}>…</span>}
            <button
              className="agri-icon-btn"
              style={p === page ? { background: "var(--agri-primary)", color: "#fff", borderColor: "var(--agri-primary)" } : undefined}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          </span>
        );
      })}

      <button className="agri-icon-btn" disabled={page === totalPages} onClick={() => onChange(page + 1)} aria-label="Next page">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
