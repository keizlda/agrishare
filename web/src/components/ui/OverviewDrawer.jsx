import { useEffect, useRef, useState } from "react";
import { BarChart3, Info, X } from "lucide-react";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function OverviewDrawer({
  title = "Overview at a Glance",
  subtitle = "Key highlights and quick stats",
  children,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    const focusable = panel ? Array.from(panel.querySelectorAll(FOCUSABLE_SELECTOR)) : [];
    focusable[0]?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="agri-overview-trigger-row">
      <button
        ref={triggerRef}
        type="button"
        className="agri-info-btn"
        onClick={() => setOpen(true)}
        aria-label="Overview at a glance"
      >
        <Info size={20} />
        <span className="agri-info-tooltip">Overview at a glance</span>
      </button>

      {open && (
        <>
          <div className="agri-overview-overlay" onClick={close} />
          <div ref={panelRef} className="agri-overview-panel" role="dialog" aria-modal="true" aria-label={title}>
            <div className="agri-overview-drawer-header">
              <div className="agri-overview-header-left">
                <div className="agri-overview-icon">
                  <BarChart3 size={18} />
                </div>
                <div>
                  <div className="agri-overview-title">{title}</div>
                  <div className="agri-overview-sub">{subtitle}</div>
                </div>
              </div>
              <button type="button" className="agri-icon-btn" onClick={close} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <div className="agri-overview-drawer-body">{children}</div>
          </div>
        </>
      )}
    </div>
  );
}
