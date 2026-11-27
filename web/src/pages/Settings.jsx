import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, KeyRound, ListChecks, Save, SlidersHorizontal, UserCog } from "lucide-react";
import Toast from "../components/ui/Toast.jsx";
import ManagedLists from "../components/lists/ManagedLists.jsx";
import FaPresidents from "../components/accounts/FaPresidents.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { getOrgSettings, updateOrgSettings } from "../lib/api/orgSettings.js";
import { friendlyError } from "../lib/friendlyError.js";
import { CONTACT_ERROR, CONTACT_PLACEHOLDER, contactInput, isValidContact } from "../lib/contact.js";

export default function Settings() {
  const { user } = useAuth();
  const isMAO = user?.role !== "FA President";
  // MAO Admin: General (organization, password), Lists (barangays,
  // sitios/puroks, farmers' associations, crops) and the Farmers'
  // Association President accounts. ?tab=lists / ?tab=fa open the others.
  const [params, setParams] = useSearchParams();
  const tab = ["lists", "fa"].includes(params.get("tab")) ? params.get("tab") : "general";

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
    <div className="agri-fill-root">
      <div className="agri-tabs" role="tablist" aria-label="Settings">
        <button type="button" role="tab" aria-selected={tab === "general"} className={`agri-tab${tab === "general" ? " active" : ""}`} onClick={() => setParams({}, { replace: true })}>
          <SlidersHorizontal size={14} /> General
        </button>
        <button type="button" role="tab" aria-selected={tab === "lists"} className={`agri-tab${tab === "lists" ? " active" : ""}`} onClick={() => setParams({ tab: "lists" }, { replace: true })}>
          <ListChecks size={14} /> Lists
        </button>
        <button type="button" role="tab" aria-selected={tab === "fa"} className={`agri-tab${tab === "fa" ? " active" : ""}`} onClick={() => setParams({ tab: "fa" }, { replace: true })}>
          <UserCog size={14} /> Farmers&apos; Association Presidents
        </button>
      </div>
      {tab === "lists" ? (
        <ManagedLists />
      ) : tab === "fa" ? (
        <FaPresidents />
      ) : (
        <div className="agri-settings-scroll">
          <div className="agri-settings-grid">
            <GeneralInformation />
            <ChangePassword />
          </div>
        </div>
      )}
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
      .catch((err) => setLoadError(friendlyError(err, "Couldn't load settings.")))
      .finally(() => setLoading(false));
  }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const [contactError, setContactError] = useState("");

  async function handleSave(e) {
    e.preventDefault();
    if (form.contactNumber && !isValidContact(form.contactNumber)) {
      setContactError(CONTACT_ERROR);
      return;
    }
    setContactError("");
    setSaving(true);
    try {
      const saved = await updateOrgSettings(form);
      setForm(saved);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Couldn't save settings.") });
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

      {loading ? (
        <div className="agri-muted" style={{ fontSize: "0.85rem" }}>Loading…</div>
      ) : !form ? null : (
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
              <input
                type="tel"
                inputMode="numeric"
                maxLength={11}
                className={`form-control${contactError ? " is-invalid" : ""}`}
                value={form.contactNumber ?? ""}
                placeholder={CONTACT_PLACEHOLDER}
                onChange={(e) => { update("contactNumber", contactInput(e.target.value)); setContactError(""); }}
              />
              {contactError && <div style={{ color: "var(--agri-red)", fontSize: "0.72rem", marginTop: 4 }}>{contactError}</div>}
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

      <hr style={{ margin: "24px 0", borderColor: "var(--agri-divider)" }} />

      <div style={{ fontWeight: 700, marginBottom: 16 }}>System Preferences</div>
      <div className="row g-3">
        <Field label="Date Format" col={4}>
          <select className="form-select"><option>MM/DD/YYYY</option></select>
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
  const { user, passwordChanged } = useAuth();
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
    setSaving(true);
    try {
      // The current password is checked even when another field has a
      // problem, so every error shows at once. No dedicated "verify current
      // password" API — re-authenticating with it is the standard way to
      // confirm it's correct before changing it.
      if (currentPassword) {
        const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
        // Only a rejected password means "incorrect" — no connection or a
        // server problem is reported as what it is (the catch below).
        if (verifyError?.code === "invalid_credentials" || verifyError?.message === "Invalid login credentials") {
          found.current = "Current password is incorrect.";
        } else if (verifyError) {
          throw verifyError;
        }
      }
      setErrors(found);
      if (Object.keys(found).length > 0) return;

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      // No longer a temporary password (the reminder goes away).
      await supabase.rpc("clear_must_change_password");
      passwordChanged();
      setToast({ tone: "success", message: "Password updated" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Couldn't update your password.") });
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
          style={{ position: "absolute", right: 10, top: 9, background: "none", border: "none", color: "var(--agri-icon-muted)" }}
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

// One column on phones; `col` (of 12) from 576px up.
function Field({ label, col, children }) {
  return (
    <div className={`col-12 col-sm-${col}`}>
      <label className="agri-form-label">{label}</label>
      {children}
    </div>
  );
}
