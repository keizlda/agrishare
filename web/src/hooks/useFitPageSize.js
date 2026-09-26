import { useEffect, useState } from "react";

const DESKTOP = "(min-width: 1024px)";

// Rows-per-page that exactly fill a full-height table area, so the table card
// has no blank space and no inner scrollbar for the first page. Measures the
// real header + first data row of `ref` (a scroll container wrapping a table)
// and recomputes on resize. Below 1024px the page scrolls normally, so it
// falls back to a fixed size. `remeasureKey` should change when rows first
// appear (rows can't be measured while the table is empty/loading).
export function useFitPageSize(ref, { fallback = 10, min = 5, remeasureKey } = {}) {
  const [size, setSize] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mq = window.matchMedia(DESKTOP);

    function measure() {
      if (!mq.matches) {
        setSize(fallback);
        return;
      }
      const row = [...el.querySelectorAll("tbody tr")].find((tr) => tr.firstElementChild && tr.firstElementChild.colSpan === 1);
      if (!row) return;
      const head = el.querySelector("thead")?.offsetHeight ?? 0;
      const rowHeight = row.getBoundingClientRect().height;
      const available = el.clientHeight - head - 2;
      if (rowHeight > 0 && available > 0) setSize(Math.max(min, Math.floor(available / rowHeight)));
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    mq.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", measure);
    };
  }, [ref, fallback, min, remeasureKey]);

  return size;
}
