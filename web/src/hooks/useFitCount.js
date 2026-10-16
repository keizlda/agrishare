import { useEffect, useState } from "react";

const DESKTOP = "(min-width: 1024px)";

// How many rows fit in `ref` — a list container whose height comes from the
// layout (a flex:1 card body on a full-height page), not from its rows.
// Divides the container height by the first row's *natural* height (its
// content + padding + border, ignoring any flex-grow stretch), and
// recomputes whenever the container resizes (ResizeObserver) or `query`
// starts/stops matching. While `query` doesn't match, the page scrolls with
// natural heights and this returns `max`. `remeasureKey` should change when
// rows first appear.
export function useFitCount(ref, { max, min = 1, query = DESKTOP, remeasureKey } = {}) {
  const [count, setCount] = useState(max);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mq = window.matchMedia(query);

    function measure() {
      if (!mq.matches) {
        setCount(max);
        return;
      }
      const row = el.firstElementChild;
      if (!row) return;
      const cs = getComputedStyle(row);
      const content = Math.max(0, ...[...row.children].map((c) => c.offsetHeight));
      const rowHeight = content + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
      if (rowHeight > 0 && el.clientHeight > 0) {
        setCount(Math.max(min, Math.min(max, Math.floor(el.clientHeight / rowHeight))));
      }
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    mq.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", measure);
    };
  }, [ref, max, min, query, remeasureKey]);

  return count;
}
