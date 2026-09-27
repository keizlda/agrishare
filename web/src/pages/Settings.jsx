import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Save } from "lucide-react";
import Toast from "../components/ui/Toast.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { getOrgSettings, updateOrgSettings } from "../lib/api/orgSettings.js";

export default function Settings() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";

  // General Information is org-wide config (MAO-only); Change Password is
  // per-user, so FA President reaches this same page for just that.
  if (!isMAO) {
    return (
      <div style={{ maxWidth: 420 }}>
        <ChangePassword />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
      <GeneralInformation />
      <ChangePassword />
    </div>
  );
}

function GeneralInformation() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    getOrgSettings()
      .then(setForm)
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await updateOrgSettings(form);
      setForm(saved);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setToast({ tone: "error", message: err.message || "Couldn't save settings." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agri-card" style={{ padding: 20 }}>
      <div style={{ fontWeight: 700, marginBottom: 16 }}>General Information</div>

      {loadError && (
        <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{loadError}</div>
      )}

      {loading || !form ? (
        <div className="agri-muted" style={{ fontSize: "0.85rem" }}>Loading…</div>
      ) : (
        <form onSubmit={handleSave}>
          <div className="row g-3">
            <Field label="LGU / Office Name" col={6}>
              <input className="form-control" value={form.lguName} onChange={(e) => update("lguName", e.target.value)} />
            </Field>
            <Field label="System Name" col={6}>
              <input className="form-control" value={form.systemName} onChange={(e) => update("systemName", e.target.value)} />
            </Field>
            <Field label="Address" col={6}>
              <input className="form-control" value={form.address} onChange={(e) => update("address", e.target.value)} />
            </Field>
            <Field label="Contact Number" col={6}>
              <input type="tel" inputMode="numeric" className="form-control" value={form.contactNumber} onChange={(e) => update("contactNumber", e.target.value)} />
            </Field>
            <Field label="Email Address" col={6}>
              <input type="email" className="form-control" value={form.email} onChange={(e) => update("email", e.target.value)} />
            </Field>
            <Field label="Fiscal Year" col={6}>
              <select className="form-select" value={form.fiscalYear} onChange={(e) => update("fiscalYear", e.target.value)}>
                <option>2023</option><option>2024</option><option>2025</option>
              </select>
            </Field>
          </div>
          <button type="submit" className="btn btn-agri-primary d-flex align-items-center gap-2 mt-4" disabled={saving}>
            <Save size={16} /> {saving ? "Saving…" : saved ? "Saved!" : "Save Changes"}
          </button>
        </form>
      )}

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

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

const MIN_PASSWORD_LENGTH = 8;

function ChangePassword() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  function validate() {
    const next = {};
    if (!currentPassword) next.current = "Current password is required.";
    if (!newPassword) next.new = "New password is required.";
    else if (newPassword.length < MIN_PASSWORD_LENGTH) next.new = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    else if (currentPassword && newPassword === currentPassword) next.new = "New password must be different from your current password.";
    if (!confirmPassword) next.confirm = "Please confirm your new password.";
    else if (confirmPassword !== newPassword) next.confirm = "Passwords do not match.";
    return next;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      // No dedicated "verify current password" API — re-authenticating with
      // it is the standard way to confirm it's correct before changing it.
      const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
      if (verifyError) {
        setErrors({ current: "Current password is incorrect." });
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setToast({ tone: "success", message: "Password updated" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setToast({ tone: "error", message: err.message || "Couldn't update your password." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agri-card" style={{ padding: 20, alignSelf: "flex-start" }}>
      <div style={{ fontWeight: 700, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
        <KeyRound size={17} /> Change Password
      </div>
      <form onSubmit={handleSubmit}>
        <PasswordField
          label="Current Password"
          placeholder="Enter current password"
          value={currentPassword}
          onChange={(v) => { setCurrentPassword(v); setErrors((e) => ({ ...e, current: undefined })); }}
          show={showCurrent}
          onToggleShow={() => setShowCurrent((s) => !s)}
          error={errors.current}
          disabled={saving}
        />
        <PasswordField
          label="New Password"
          placeholder="Enter new password"
          value={newPassword}
          onChange={(v) => { setNewPassword(v); setErrors((e) => ({ ...e, new: undefined })); }}
          show={showNew}
          onToggleShow={() => setShowNew((s) => !s)}
          error={errors.new}
          disabled={saving}
        />
        <PasswordField
          label="Confirm New Password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(v) => { setConfirmPassword(v); setErrors((e) => ({ ...e, confirm: undefined })); }}
          show={showConfirm}
          onToggleShow={() => setShowConfirm((s) => !s)}
          error={errors.confirm}
          disabled={saving}
        />
        <button type="submit" className="btn btn-agri-primary w-100 d-flex align-items-center justify-content-center gap-2" disabled={saving}>
          {saving && <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />}
          {saving ? "Updating…" : "Update Password"}
        </button>
      </form>

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

function PasswordField({ label, placeholder, value, onChange, show, onToggleShow, error, disabled }) {
  return (
    <div className="mb-3">
      <label className="agri-form-label">{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          className="form-control"
          style={{ paddingRight: 36, borderColor: error ? "var(--agri-red)" : undefined }}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onToggleShow}
          style={{ position: "absolute", right: 10, top: 9, background: "none", border: "none", color: "#8b978f" }}
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          tabIndex={-1}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <div style={{ color: "var(--agri-red)", fontSize: "0.78rem", marginTop: 4 }}>{error}</div>}
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
