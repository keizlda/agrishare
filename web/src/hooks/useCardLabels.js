import { useEffect } from "react";

// On phones a list table with the agri-table-cards class shows each row as
// a card, every value labelled with its column heading (theme.css, "Phone
// card rows"). This copies each
// heading onto its column's cells as data-label, and again whenever rows
// change (paging, filtering, loading). `ref` is the table's wrapper. Cells
// that span columns ("Loading…") get no label.
export function useCardLabels(ref) {
  useEffect(() => {
    const table = ref.current?.querySelector("table");
    if (!table) return undefined;

    function label() {
      const headings = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      for (const row of table.querySelectorAll("tbody tr")) {
        for (const cell of row.cells) {
          if (cell.colSpan !== 1) continue;
          const heading = headings[cell.cellIndex] ?? "";
          if (cell.getAttribute("data-label") !== heading) cell.setAttribute("data-label", heading);
        }
      }
    }

    label();
    const observer = new MutationObserver(label);
    observer.observe(table, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref]);
}
