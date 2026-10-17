import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

// While `dirty`, leaving the page asks first:
// - clicking an in-app link (top bar, menus) is held back and
//   `onLeaveRequest(go)` is called — call go() to continue (e.g. after a
//   "Discard changes?" confirmation);
// - reloading or closing the tab shows the browser's own "Leave site?" prompt.
// (The app uses BrowserRouter, which has no navigation blocker, so links are
// intercepted directly. The browser's Back button isn't intercepted.)
export function useUnsavedChangesGuard(dirty, onLeaveRequest) {
  const navigate = useNavigate();
  const onLeaveRef = useRef(onLeaveRequest);
  onLeaveRef.current = onLeaveRequest;

  useEffect(() => {
    if (!dirty) return undefined;

    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest?.("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const to = `${url.pathname}${url.search}${url.hash}`;
      if (to === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
      e.preventDefault();
      e.stopPropagation();
      onLeaveRef.current(() => navigate(to));
    }

    function onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, navigate]);
}
