import { useState } from "react";
import { KeyRound, Save } from "lucide-react";

const TABS = ["General Settings", "User Management", "Backup & Restore", "System Logs"];

export default function Settings() {
  const [tab, setTab] = useState(TABS[0]);
  const [saved, setSaved] = useState(false);

  function handleSave(e) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <div className="agri-card" style={{ padding: "6px 16px", marginBottom: 16, display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "10px 14px", background: "none", border: "none", borderBottom: t === tab ? "2px solid var(--agri-primary)" : "2px solid transparent",
              color: t === tab ? "var(--agri-primary-dark)" : "#667066", fontWeight: t === tab ? 600 : 500, fontSize: "0.85rem",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "General Settings" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
          <div className="agri-card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 16 }}>General Information</div>
            <form onSubmit={handleSave}>
              <div className="row g-3">
                <Field label="LGU / Office Name" col={6}><input className="form-control" defaultValue="Municipality of Labangan" /></Field>
                <Field label="System Name" col={6}><input className="form-control" defaultValue="AgriShare - LGU Resource Management System" /></Field>
                <Field label="Address" col={6}><input className="form-control" defaultValue="Barangay Langapud, Labangan, Zamboanga del Sur" /></Field>
                <Field label="Contact Number" col={6}><input className="form-control" defaultValue="0939 297 9198" /></Field>
                <Field label="Email Address" col={6}><input type="email" className="form-control" defaultValue="mao.labangan@example.gov.ph" /></Field>
                <Field label="Fiscal Year" col={6}>
                  <select className="form-select" defaultValue="2024">
                    <option>2023</option><option>2024</option><option>2025</option>
                  </select>
                </Field>
              </div>
              <button type="submit" className="btn btn-agri-primary d-flex align-items-center gap-2 mt-4">
                <Save size={16} /> {saved ? "Saved!" : "Save Changes"}
              </button>
            </form>

            <hr style={{ margin: "24px 0", borderColor: "var(--agri-border)" }} />

            <div style={{ fontWeight: 700, marginBottom: 16 }}>System Preferences</div>
            <div className="row g-3">
              <Field label="Date Format" col={4}>
                <select className="form-select"><option>MM/DD/YYYY</option><option>DD/MM/YYYY</option></select>
              </Field>
              <Field label="Time Format" col={4}>
                <select className="form-select"><option>12-Hour (AM/PM)</option><option>24-Hour</option></select>
              </Field>
              <Field label="Language" col={4}>
                <select className="form-select"><option>English</option><option>Filipino</option></select>
              </Field>
            </div>
          </div>

          <div className="agri-card" style={{ padding: 20, alignSelf: "flex-start" }}>
            <div style={{ fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <KeyRound size={17} /> Change Password
            </div>
            <label className="agri-form-label">Current Password</label>
            <input type="password" className="form-control mb-3" placeholder="Enter current password" />
            <label className="agri-form-label">New Password</label>
            <input type="password" className="form-control mb-3" placeholder="Enter new password" />
            <label className="agri-form-label">Confirm New Password</label>
            <input type="password" className="form-control mb-3" placeholder="Confirm new password" />
            <button className="btn btn-agri-primary w-100">Update Password</button>
          </div>
        </div>
      )}

      {tab !== "General Settings" && (
        <div className="agri-card" style={{ padding: 40, textAlign: "center" }}>
          <div className="agri-muted">{tab} will be available once the backend and account roles are wired up.</div>
        </div>
      )}
    </div>
  );
}

function Field({ label, col, children }) {
  return (
    <div className={`col-${col}`}>
      <label className="agri-form-label">{label}</label>
      {children}
    </div>
  );
}
