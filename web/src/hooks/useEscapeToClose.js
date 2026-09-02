import { useEffect } from "react";

export function useEscapeToClose(active, onClose) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onClose]);
}
