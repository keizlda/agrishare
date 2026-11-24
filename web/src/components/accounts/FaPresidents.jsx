import { useEffect, useState } from "react";
import { KeyRound, Plus, X } from "lucide-react";
import Toast from "../ui/Toast.jsx";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { useBarangays } from "../../hooks/useBarangays.js";
import { createFaPresident, listFaPresidents, resetFaPresidentPassword, setFaPresidentBarangay } from "../../lib/api/faPresidents.js";
import { friendlyError } from "../../lib/friendlyError.js";

const EMPTY = { fullName: "", email: "", contactNo: "", barangayId: "" };

// Settings → Farmers' Association Presidents (MAO Admin): each account and
// its barangay (the only barangay it can see), a new account, a new
// temporary password.
export default function FaPresidents() {
  const barangays = useBarangays();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(null); // { fa, barangayId }
  const [resetting, setResetting] = useState(null);
  const [credentials, setCredentials] = useState(null); // { name, email, password, barangay }
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = () => listFaPresidents().then(setRows).catch((err) => setLoadError(friendlyError(err, "Couldn't load the accounts.")));
  useEffect(() => {
    load();
  }, []);
  const nameOf = (id) => barangays.find((b) => b.id === id)?.name ?? "—";

  async function confirmMove() {
    setBusy(true);
    try {
      await setFaPresidentBarangay(moving.fa.id, moving.barangayId);
      setRows((r) => r.map((x) => (x.id === moving.fa.id ? { ...x, barangayId: Number(moving.barangayId) } : x)));
      setToast({ tone: "success", message: `${moving.fa.name} now sees Barangay ${nameOf(Number(moving.barangayId))} only.` });
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Couldn't change the barangay.") });
    } finally {
      setBusy(false);
      setMoving(null);
    }
  }

  async function confirmReset() {
    setBusy(true);
    try {
      const { password } = await resetFaPresidentPassword(resetting.id);
      setCredentials({ name: resetting.name, email: resetting.email, password, barangay: nameOf(resetting.barangayId) });
    } catch (err) {
      setToast({ tone: "error", message: friendlyError(err, "Couldn't set a new password.") });
    } finally {
      setBusy(false);
      setResetting(null);
    }
  }

  return (
    <div className="agri-card agri-fa-accounts">
      <div className="agri-fa-head">
        <div>
          <div style={{ fontWeight: 700 }}>Farmers&apos; Association Presidents</div>
          <div className="agri-muted" style={{ fontSize: "0.8rem" }}>Each account belongs to one barangay and can only see that barangay&apos;s farmers, requests, submissions and distributions.</div>
        </div>
        <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add account
        </button>
      </div>
      {loadError && <div className="agri-pill red" role="alert" style={{ display: "block", padding: "8px 12px", margin: "10px 0" }}>{loadError}</div>}
      <div className="agri-table-wrap">
        <table className="agri-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Barangay</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={4} className="agri-muted text-center py-4">Loading accounts…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={4} className="agri-muted text-center py-4">No Farmers&apos; Association President accounts yet.</td></tr>}
            {rows?.map((fa) => (
              <tr key={fa.id}>
                <td className="agri-row-title">{fa.name || "—"}</td>
                <td>{fa.email}</td>
                <td style={{ width: 240 }}>
                  <select
                    className="form-select form-select-sm"
                    value={String(fa.barangayId ?? "")}
                    onChange={(e) => setMoving({ fa, barangayId: e.target.value })}
                    aria-label={`Barangay of ${fa.name}`}
                  >
                    {barangays.filter((b) => b.isActive || b.id === fa.barangayId).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                  </select>
                </td>
                <td className="text-end">
                  <button type="button" className="btn btn-sm btn-outline-secondary d-inline-flex align-items-center gap-1" onClick={() => setResetting(fa)}>
                    <KeyRound size={14} /> New password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddAccount
          barangays={barangays.filter((b) => b.isActive)}
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            setCredentials(created);
            load();
          }}
        />
      )}
      {moving && (
        <ConfirmDialog
          title={`Move ${moving.fa.name} to Barangay ${nameOf(Number(moving.barangayId))}?`}
          message={`They'll see Barangay ${nameOf(Number(moving.barangayId))}'s records only, and no longer ${nameOf(moving.fa.barangayId)}'s.`}
          confirmLabel="Move"
          busy={busy}
          onConfirm={confirmMove}
          onCancel={() => setMoving(null)}
        />
      )}
      {resetting && (
        <ConfirmDialog
          title={`Set a new password for ${resetting.name}?`}
          message="Their current password stops working. You'll see the new temporary password once."
          confirmLabel="Set new password"
          busy={busy}
          onConfirm={confirmReset}
          onCancel={() => setResetting(null)}
        />
      )}
      {credentials && <CredentialsDialog {...credentials} onClose={() => setCredentials(null)} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

function AddAccount({ barangays, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEscapeToClose(true, () => !saving && onClose());
  const update = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function save(e) {
    e.preventDefault();
    const next = {};
    if (!form.fullName.trim()) next.fullName = "Enter the full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (!form.barangayId) next.barangayId = "Choose the barangay.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    setError("");
    try {
      const created = await createFaPresident(form);
      onCreated({ name: form.fullName.trim(), email: created.email, password: created.password, barangay: created.barangay });
    } catch (err) {
      setError(friendlyError(err, "Couldn't create the account."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="agri-modal-backdrop" onClick={() => !saving && onClose()}>
      <form className="agri-card agri-modal" style={{ "--agri-modal-width": "460px" }} role="dialog" aria-label="Add Farmers' Association President" onClick={(e) => e.stopPropagation()} onSubmit={save} noValidate>
        <div className="agri-modal-header">
          <div className="agri-modal-title">Add Farmers&apos; Association President</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={saving}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {error && <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 12, padding: "8px 12px" }}>{error}</div>}
          {[["fullName", "Full name", "text"], ["email", "Email (their sign-in)", "email"], ["contactNo", "Contact no. (optional)", "tel"]].map(([k, label, type]) => (
            <div key={k} className="mb-3">
              <label className="agri-form-label" htmlFor={`fa-${k}`}>{label}</label>
              <input id={`fa-${k}`} type={type} className={`form-control${errors[k] ? " is-invalid" : ""}`} value={form[k]} onChange={(e) => update(k, e.target.value)} disabled={saving} />
              {errors[k] && <div className="agri-post-field-error">{errors[k]}</div>}
            </div>
          ))}
          <label className="agri-form-label" htmlFor="fa-barangay">Barangay</label>
          <select id="fa-barangay" className={`form-select${errors.barangayId ? " is-invalid" : ""}`} value={form.barangayId} onChange={(e) => update("barangayId", e.target.value)} disabled={saving}>
            <option value="" disabled>Select barangay</option>
            {barangays.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
          {errors.barangayId && <div className="agri-post-field-error">{errors.barangayId}</div>}
          <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 8 }}>They&apos;ll only see this barangay&apos;s records. A temporary password is made for them.</div>
        </div>
        <div className="agri-modal-footer">
          <button type="submit" className="btn btn-agri-primary w-100" disabled={saving}>{saving ? "Creating…" : "Create account"}</button>
        </div>
      </form>
    </div>
  );
}

function CredentialsDialog({ name, email, password, barangay, onClose }) {
  useEscapeToClose(true, onClose);
  return (
    <div className="agri-modal-backdrop">
      <div className="agri-card agri-modal" style={{ "--agri-modal-width": "420px" }} role="dialog" aria-label="Sign-in details">
        <div className="agri-modal-header"><div className="agri-modal-title">Sign-in details for {name}</div></div>
        <div className="agri-modal-body">
          <div className="agri-fa-cred"><span>Barangay</span><strong>{barangay}</strong></div>
          <div className="agri-fa-cred"><span>Email</span><strong>{email}</strong></div>
          <div className="agri-fa-cred"><span>Temporary password</span><strong className="agri-fa-password">{password}</strong></div>
          <div className="agri-muted" style={{ fontSize: "0.8rem", marginTop: 10 }}>This password is shown only now. Give it to them in person; they should change it in Settings after signing in.</div>
        </div>
        <div className="agri-modal-footer"><button type="button" className="btn btn-agri-primary w-100" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
