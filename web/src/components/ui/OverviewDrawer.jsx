import { useState } from "react";
import { BarChart3, ChevronRight, X } from "lucide-react";

export default function OverviewDrawer({
  title = "Overview at a Glance",
  subtitle = "Key highlights and quick stats",
  children,
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {!open && (
        <button
          type="button"
          className="agri-overview-tab"
          onClick={() => setOpen(true)}
          aria-label="Open overview"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {open && <div className="agri-overview-backdrop" onClick={() => setOpen(false)} />}

      <aside className={`agri-overview-drawer${open ? " open" : ""}`}>
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
          <button type="button" className="agri-icon-btn" onClick={() => setOpen(false)} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="agri-overview-drawer-body">{children}</div>
      </aside>
    </>
  );
}
