import { useEffect, useState } from "react";

const QUERY = "(max-width: 860px)";

// Same breakpoint Topbar already collapses its own nav at. Used to branch
// AppLayout between the unchanged desktop shell and MobileShell entirely —
// not to reflow the desktop one, so there's zero risk of this touching the
// desktop render path.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
