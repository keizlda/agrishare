import { AlertTriangle } from "lucide-react";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";

export default function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger = true, onConfirm, onCancel }) {
  useEscapeToClose(true, onCancel);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}
      onClick={onCancel}
    >
      <div className="agri-card" style={{ width: 380, maxWidth: "90vw", padding: 22, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            width: 46, height: 46, borderRadius: "50%", background: "var(--agri-red-bg)", color: "var(--agri-red)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
          }}
        >
          <AlertTriangle size={22} />
        </div>
        <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>{title}</div>
        <div className="agri-muted" style={{ fontSize: "0.85rem", marginBottom: 20 }}>{message}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn btn-outline-secondary flex-fill" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={`btn flex-fill ${danger ? "btn-outline-danger" : "btn-agri-primary"}`}
            style={danger ? { background: "var(--agri-red)", color: "#fff", borderColor: "var(--agri-red)" } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
