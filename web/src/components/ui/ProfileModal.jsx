import { User as UserIcon, X } from "lucide-react";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";

export default function ProfileModal({ user, onClose }) {
  useEscapeToClose(true, onClose);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div className="agri-card" style={{ width: 380, maxWidth: "92vw", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div className="agri-panel-header">
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Profile</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <div className="agri-avatar" style={{ width: 52, height: 52 }}>
            <UserIcon size={24} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>{user?.name ?? "—"}</div>
            <div className="agri-muted" style={{ fontSize: "0.8rem" }}>{user?.role ?? "—"}</div>
          </div>
        </div>

        <div className="agri-detail-row"><div><div className="agri-detail-label">Email</div>{user?.email ?? "—"}</div></div>
        <div className="agri-detail-row"><div><div className="agri-detail-label">Office</div>{user?.office || "—"}</div></div>
      </div>
    </div>
  );
}
