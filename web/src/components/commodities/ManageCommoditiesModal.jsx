import { useEffect, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { RateInput } from "./CommodityFields.jsx";
import { isKg, validateCommodity } from "../../lib/commodityRules.js";
import { categoryOption, deleteCommodity, saveCommodity } from "../../lib/api/commodities.js";
import { formatRate } from "../../lib/allocation.js";
import { listEntries } from "../../lib/api/lists.js";
import { friendlyError } from "../../lib/friendlyError.js";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";

// "Manage commodities" (MAO Admin, from the distribution form): every
// commodity with its category, rate and the type of farmer it's for;
// rename, edit the rate or type of farmer, or delete.
// Deleting is a soft delete: records that used the commodity keep showing
// it, but it's no longer offered for new distributions.
export default function ManageCommoditiesModal({ commodities, onClose, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(null); // { id, name, rate, farmerTypeId }
  const [farmerTypes, setFarmerTypes] = useState([]);
  useEffect(() => {
    listEntries("farmerTypes").then(setFarmerTypes).catch(() => {});
  }, []);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }
  const [pendingDelete, setPendingDelete] = useState(null);

  useEscapeToClose(!editing && !pendingDelete && !busy, onClose);

  const list = [...commodities].sort((a, b) => a.name.localeCompare(b.name));

  function start(c) {
    setEditing({ id: c.id, name: c.name, rate: c.rate == null ? "" : String(c.rate), farmerTypeId: c.farmerTypeId == null ? "" : String(c.farmerTypeId) });
    setErrors({});
    setMessage(null);
  }

  async function save(c) {
    const found = validateCommodity({ name: editing.name, rate: editing.rate }, commodities.filter((x) => x.id !== c.id), c.unit);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const saved = await saveCommodity(c.id, { name: editing.name.trim().replace(/\s+/g, " "), category: c.category, rate: isKg(c.unit) ? editing.rate.trim() : "", farmerTypeId: editing.farmerTypeId });
      onUpdated(saved);
      setEditing(null);
      setMessage({ tone: "success", text: `${saved.name} saved.` });
    } catch (err) {
      setErrors({ form: friendlyError(err, "Couldn't save this commodity. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function remove(c) {
    setPendingDelete(null);
    setBusy(true);
    try {
      await deleteCommodity(c.id);
      onDeleted(c.id);
      setMessage({ tone: "success", text: `${c.name} deleted.` });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err, "Couldn't delete this commodity.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div className="agri-modal-backdrop agri-modal-backdrop-top" onClick={busy ? undefined : onClose}>
      <div
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "780px" }}
        role="dialog"
        aria-label="Manage commodities"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">Manage commodities</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {message && (
            <div className={`agri-pill ${message.tone === "error" ? "red" : "green"}`} role="status" style={{ display: "block", marginBottom: 12, padding: "8px 12px" }}>{message.text}</div>
          )}
          {errors.form && <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 12, padding: "8px 12px" }}>{errors.form}</div>}
          <div className="agri-table-wrap agri-manage-commodities">
            <table className="agri-table">
              <thead>
                <tr><th>Name</th><th>Category</th><th>Rate</th><th>Type of Farmer</th><th className="text-end" aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const on = editing?.id === c.id;
                  return (
                    <tr key={c.id}>
                      <td>
                        {on ? (
                          <>
                            <input className={`form-control form-control-sm${errors.name ? " is-invalid" : ""}`} value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} aria-label={`Name of ${c.name}`} disabled={busy} autoFocus />
                            {errors.name && <div className="invalid-feedback d-block">{errors.name}</div>}
                          </>
                        ) : (
                          c.name
                        )}
                      </td>
                      <td>{categoryOption(c.category)}</td>
                      <td>
                        {on && isKg(c.unit) ? (
                          <>
                            <RateInput id={`manage-rate-${c.id}`} value={editing.rate} onChange={(v) => setEditing((x) => ({ ...x, rate: v }))} invalid={!!errors.rate} disabled={busy} small label={`Rate of ${c.name}`} />
                            {errors.rate && <div className="invalid-feedback d-block">{errors.rate}</div>}
                          </>
                        ) : isKg(c.unit) ? (
                          formatRate(c.rate)
                        ) : (
                          <span className="agri-muted">— ({c.unit})</span>
                        )}
                      </td>
                      <td>
                        {on ? (
                          <select className="form-select form-select-sm" value={editing.farmerTypeId} onChange={(e) => setEditing((x) => ({ ...x, farmerTypeId: e.target.value }))} aria-label={`Type of farmer for ${c.name}`} disabled={busy}>
                            <option value="">None</option>
                            {farmerTypes.filter((t) => t.isActive || String(t.id) === editing.farmerTypeId).map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
                          </select>
                        ) : (
                          c.farmerType || <span className="agri-muted">—</span>
                        )}
                      </td>
                      <td className="text-end agri-manage-actions">
                        {on ? (
                          <>
                            <button type="button" className="btn btn-sm btn-agri-primary" onClick={() => save(c)} disabled={busy} aria-label={`Save ${c.name}`}><Check size={14} /> Save</button>
                            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setEditing(null); setErrors({}); }} disabled={busy}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button type="button" className="agri-icon-btn" onClick={() => start(c)} disabled={busy || !!editing} aria-label={`Edit ${c.name}`} title="Rename or edit the rate"><Pencil size={14} /></button>
                            <button type="button" className="agri-icon-btn agri-type-remove" onClick={() => setPendingDelete(c)} disabled={busy || !!editing} aria-label={`Delete ${c.name}`} title="Delete"><Trash2 size={14} /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {list.length === 0 && (
                  <tr><td colSpan={5} className="agri-muted text-center py-3">No commodities yet. Add one with “+ Add new commodity”.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="agri-field-hint">Rate changes apply to new distributions and are recorded in the Activity Log. Saved distributions keep the rate they were saved with. The type of farmer is suggested when tagging beneficiaries.</div>
        </div>
        <div className="agri-modal-footer">
          <button type="button" className="btn btn-agri-primary" onClick={onClose} disabled={busy}>Done</button>
        </div>
      </div>
    </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          message="It won't be offered for new distributions. Past distributions, requests and reports keep showing it."
          confirmLabel="Delete"
          onConfirm={() => remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
