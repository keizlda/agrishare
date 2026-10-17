import { useEffect, useState } from "react";

const DESKTOP = "(min-width: 1024px)";

// Rows-per-page that exactly fill a full-height table area (`ref`, the scroll
// container wrapping the table), so a full page ends right above the table
// footer with no blank space and no inner scrollbar:
//   rows = floor((area height − header row height) / row height), minimum `min`
// The few leftover pixels are shared out across the rows (the
// --agri-fit-row-height variable, see theme.css), so the last row ends exactly
// at the bottom of the area.
//
// The row height is the tallest natural (unstretched) row seen since the
// area last changed size, so a page with a two-line row can't overflow.
// Re-measures when the area resizes (ResizeObserver), on window resize, and
// when the rows change. Below 1024px the page scrolls normally, so it falls
// back to a fixed size. `remeasureKey` should change when the table first
// renders (it can't be measured before it exists).
export function useFitPageSize(ref, { fallback = 10, min = 5, remeasureKey } = {}) {
  const [size, setSize] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mq = window.matchMedia(DESKTOP);
    let tallest = 0;
    let areaHeight = 0;

    function measure() {
      if (!mq.matches) {
        el.style.removeProperty("--agri-fit-row-height");
        setSize(fallback);
        return;
      }
      const rows = [...el.querySelectorAll("tbody tr")].filter((tr) => tr.firstElementChild && tr.firstElementChild.colSpan === 1);
      if (rows.length === 0) return;
      if (el.clientHeight !== areaHeight) {
        areaHeight = el.clientHeight;
        tallest = 0;
      }
      // Natural heights, without the stretch from the previous measurement.
      el.style.removeProperty("--agri-fit-row-height");
      for (const tr of rows) tallest = Math.max(tallest, tr.getBoundingClientRect().height);
      const head = el.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const available = el.clientHeight - head - 1;
      if (tallest <= 0 || available <= 0) return;
      const fits = Math.floor(available / tallest);
      const count = Math.max(min, fits);
      if (fits >= min) el.style.setProperty("--agri-fit-row-height", `${available / count}px`);
      setSize(count);
    }

    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    const body = el.querySelector("tbody");
    const rowsChanged = body ? new MutationObserver(measure) : null;
    rowsChanged?.observe(body, { childList: true });
    window.addEventListener("resize", measure);
    mq.addEventListener("change", measure);
    return () => {
      resize.disconnect();
      rowsChanged?.disconnect();
      window.removeEventListener("resize", measure);
      mq.removeEventListener("change", measure);
      el.style.removeProperty("--agri-fit-row-height");
    };
  }, [ref, fallback, min, remeasureKey]);

  return size;
}
