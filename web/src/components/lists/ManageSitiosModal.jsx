import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { addEntry, removeSitio, renameEntry, setEntryActive } from "../../lib/api/lists.js";
import { MAX_LIST_NAME, checkName, cleanName } from "../../lib/listMatch.js";
import { friendlyError } from "../../lib/friendlyError.js";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";

// "Manage sitios/puroks" (Farmers page): one barangay's sitio/purok list.
// The Farmers' Association President manages their own barangay's (the
// database enforces it); the MAO Admin chooses the barangay at the top.
// Removing one that farmers have hides it from the list (they keep it);
// one nobody has is deleted.
export default function ManageSitiosModal({ barangays, sitios, fixedBarangay = null, initialBarangayId = "", onSaved, onRemoved, onClose }) {
  const [barangayId, setBarangayId] = useState(fixedBarangay ? String(fixedBarangay.id) : String(initialBarangayId || ""));
  const [newName, setNewName] = useState("");
  const [addNote, setAddNote] = useState(null); // { tone, text, similar?, same? }
  const [editing, setEditing] = useState(null); // { id, name, note }
  const [pendingRemove, setPendingRemove] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { tone, text }

  useEscapeToClose(!editing && !pendingRemove && !busy, onClose);

  const ofBarangay = useMemo(() => sitios.filter((s) => barangayId && String(s.barangayId) === barangayId), [sitios, barangayId]);
  const list = ofBarangay.filter((s) => s.isActive).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const barangayName = fixedBarangay?.name ?? barangays.find((b) => String(b.id) === barangayId)?.name ?? "";

  async function add(anyway = false) {
    setMessage(null);
    const check = checkName(ofBarangay, newName, { anyway });
    if (check.error) {
      setAddNote({ tone: "error", text: check.same?.isActive ? `${check.same.name} already exists.` : check.error, same: check.same && !check.same.isActive ? check.same : null });
      return;
    }
    if (check.similar) {
      setAddNote({ tone: "warn", text: `${check.similar.name} already exists. Is it the same sitio/purok?`, similar: check.similar });
      return;
    }
    setBusy(true);
    try {
      const saved = await addEntry("sitios", check.name, barangayId);
      setNewName("");
      setAddNote(null);
      onSaved(saved);
      setMessage({ tone: "success", text: `${saved.name} added.` });
    } catch (err) {
      setAddNote({ tone: "error", text: friendlyError(err, "Couldn't add this sitio/purok.") });
    } finally {
      setBusy(false);
    }
  }

  async function restore(entry) {
    setBusy(true);
    try {
      const saved = await setEntryActive("sitios", entry.id, true);
      setNewName("");
      setAddNote(null);
      onSaved(saved);
      setMessage({ tone: "success", text: `${saved.name} is back on the list.` });
    } catch (err) {
      setAddNote({ tone: "error", text: friendlyError(err, "Couldn't bring it back.") });
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(anyway = false) {
    const entry = ofBarangay.find((s) => s.id === editing.id);
    if (cleanName(editing.name) === entry.name) {
      setEditing(null);
      return;
    }
    const check = checkName(ofBarangay, editing.name, { exceptId: entry.id, anyway });
    if (check.error) {
      setEditing((x) => ({ ...x, note: { tone: "error", text: check.error } }));
      return;
    }
    if (check.similar) {
      setEditing((x) => ({ ...x, note: { tone: "warn", text: `${check.similar.name} already exists.`, similar: check.similar } }));
      return;
    }
    setBusy(true);
    try {
      const saved = await renameEntry("sitios", entry.id, check.name);
      setEditing(null);
      onSaved(saved);
      setMessage({ tone: "success", text: `Renamed to ${saved.name}. Farmer records show the new name.` });
    } catch (err) {
      setEditing((x) => ({ ...x, note: { tone: "error", text: friendlyError(err, "Couldn't rename it.") } }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry) {
    setPendingRemove(null);
    setBusy(true);
    setMessage(null);
    try {
      const result = await removeSitio(entry.id);
      onRemoved(entry.id, result);
      setMessage({
        tone: "success",
        text: result === "hidden" ? `${entry.name} is used by farmers, so it was hidden from the list. Those farmers keep it.` : `${entry.name} deleted.`,
      });
    } catch (err) {
      setMessage({ tone: "error", text: friendlyError(err, "Couldn't remove it.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="agri-modal-backdrop agri-modal-backdrop-top" onClick={busy ? undefined : onClose}>
        <div className="agri-card agri-modal agri-modal-full" style={{ "--agri-modal-width": "520px" }} role="dialog" aria-label="Manage sitios/puroks" onClick={(e) => e.stopPropagation()}>
          <div className="agri-modal-header">
            <div className="agri-modal-title">Manage sitios/puroks</div>
            <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button>
          </div>
          <div className="agri-modal-body">
            {fixedBarangay ? (
              <div className="agri-sitio-scope">Barangay {fixedBarangay.name}</div>
            ) : (
              <div className="mb-3">
                <label className="agri-form-label" htmlFor="sitios-barangay">Barangay</label>
                <select id="sitios-barangay" className="form-select" value={barangayId} onChange={(e) => { setBarangayId(e.target.value); setAddNote(null); setEditing(null); setMessage(null); }} disabled={busy}>
                  <option value="" disabled>Select barangay</option>
                  {barangays.filter((b) => b.isActive).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
                </select>
              </div>
            )}

            {message && (
              <div className={`agri-pill ${message.tone === "error" ? "red" : "green"}`} role="status" style={{ display: "block", marginBottom: 12, padding: "8px 12px" }}>{message.text}</div>
            )}

            <form className="agri-list-addrow" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <input
                className={`form-control${addNote?.tone === "error" ? " is-invalid" : ""}`}
                value={newName}
                maxLength={MAX_LIST_NAME + 20}
                placeholder={barangayId ? "Add sitio/purok, e.g. Purok 6" : "Choose the barangay first"}
                aria-label="Add sitio/purok"
                onChange={(e) => { setNewName(e.target.value); setAddNote(null); }}
                disabled={!barangayId || busy}
              />
              <button type="submit" className="btn btn-agri-primary d-flex align-items-center gap-1" disabled={!barangayId || busy || !newName.trim()}>
                <Plus size={15} /> Add
              </button>
            </form>
            {addNote && (
              <div className={`agri-list-note ${addNote.tone}`} role="alert">
                {addNote.text}
                {addNote.same && <button type="button" className="agri-link-btn" onClick={() => restore(addNote.same)} disabled={busy}>Bring it back</button>}
                {addNote.similar && <button type="button" className="agri-link-btn" onClick={() => add(true)} disabled={busy}>Add “{cleanName(newName)}” anyway</button>}
              </div>
            )}

            <div className="agri-table-wrap agri-manage-commodities" style={{ marginTop: 12 }}>
              <table className="agri-table">
                <thead>
                  <tr><th>Name</th><th className="text-end" aria-label="Actions" /></tr>
                </thead>
                <tbody>
                  {list.map((s) => {
                    const on = editing?.id === s.id;
                    return (
                      <tr key={s.id}>
                        <td>
                          {on ? (
                            <>
                              <input
                                className={`form-control form-control-sm${editing.note?.tone === "error" ? " is-invalid" : ""}`}
                                value={editing.name}
                                maxLength={MAX_LIST_NAME + 20}
                                aria-label={`Rename ${s.name}`}
                                onChange={(e) => setEditing({ id: s.id, name: e.target.value, note: null })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); saveRename(); }
                                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                                }}
                                disabled={busy}
                                autoFocus
                              />
                              {editing.note && (
                                <div className={`agri-list-note ${editing.note.tone}`} role="alert">
                                  {editing.note.text}
                                  {editing.note.similar && <button type="button" className="agri-link-btn" onClick={() => saveRename(true)} disabled={busy}>Rename anyway</button>}
                                </div>
                              )}
                            </>
                          ) : (
                            s.name
                          )}
                        </td>
                        <td className="text-end agri-manage-actions">
                          {on ? (
                            <>
                              <button type="button" className="btn btn-sm btn-agri-primary" onClick={() => saveRename()} disabled={busy} aria-label={`Save ${s.name}`}><Check size={14} /> Save</button>
                              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="agri-icon-btn" onClick={() => { setEditing({ id: s.id, name: s.name, note: null }); setMessage(null); }} disabled={busy || !!editing} aria-label={`Rename ${s.name}`} title="Rename"><Pencil size={14} /></button>
                              <button type="button" className="agri-icon-btn agri-type-remove" onClick={() => setPendingRemove(s)} disabled={busy || !!editing} aria-label={`Delete ${s.name}`} title="Delete"><Trash2 size={14} /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {barangayId && list.length === 0 && (
                    <tr><td colSpan={2} className="agri-muted text-center py-3">No sitios/puroks yet for Barangay {barangayName}. Add the first one above.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="agri-field-hint">A sitio/purok that farmers have is hidden instead of deleted, so their records keep it.</div>
          </div>
          <div className="agri-modal-footer">
            <button type="button" className="btn btn-agri-primary" onClick={onClose} disabled={busy}>Done</button>
          </div>
        </div>
      </div>

      {pendingRemove && (
        <ConfirmDialog
          title={`Delete ${pendingRemove.name}?`}
          message="It won't be offered for new farmers. If farmers already have it, it's hidden instead and stays on their records."
          confirmLabel="Delete"
          onConfirm={() => remove(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </>
  );
}
