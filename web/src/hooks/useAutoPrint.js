import { useEffect } from "react";

// Auto-triggers the print dialog once data is ready — only when explicitly
// requested (the ?autoPrint=1 entry points: "Print"/"Download" actions),
// never for a plain "Preview", so opening a report to look at it doesn't
// unexpectedly pop a print dialog.
export function useAutoPrint(ready, enabled) {
  useEffect(() => {
    if (!ready || !enabled) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [ready, enabled]);
}
