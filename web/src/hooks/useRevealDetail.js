import { useCallback, useEffect, useState } from "react";

// Below 1024px a list page's details card sits under the list, out of
// sight on a phone. Call the returned reveal() when a row is opened: once
// the card has rendered, it's scrolled into view. (Not on selection itself,
// so a page that opens its first row on load doesn't jump down.)
export function useRevealDetail(ref) {
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    if (!requests || window.matchMedia("(min-width: 1024px)").matches) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ref, requests]);

  return useCallback(() => setRequests((n) => n + 1), []);
}
