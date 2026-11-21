import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { listAssociationItems, removeAssociationItem, saveAssociationItem } from "../../lib/api/associationRequests.js";
import { friendlyError } from "../../lib/friendlyError.js";

const MAX_NAME = 80;

// "Manage items" (MAO Admin): the list the Farmers' Association President
// picks an association request's item from. Add, rename or remove items;
// removing keeps the item's name on past requests. "Other (specify)" stays
// so the Farmers' Association President can always describe something new.
export default function ManageItemsModal({ onClose, onSaved }) {
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null); // { id, name }
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pendingRemove, setPendingRemove] = useState(null);

  useEscapeToClose(!busy, onClose);

  useEffect(() => {
    listAssociationItems()
      .then(setItems)
      .catch((err) => setLoadError(friendlyError(err, "Couldn't load the item list. Please try again.")));
  }, []);

  function nameProblem(name, id) {
    const n = name.trim().replace(/\s+/g, " ");
    if (!n) return "Enter the item name.";
    if (n.length > MAX_NAME) return `Keep it to ${MAX_NAME} characters or fewer.`;
    if (items.some((i) => i.id !== id && i.name.toLowerCase() === n.toLowerCase())) return "That item is already on the list.";
    return "";
  }

  async function run(fn, success) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      onSaved?.(success);
    } catch (err) {
      setError(friendlyError(err, "Couldn't save the item list. Please try again."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function add(e) {
    e.preventDefault();
    const problem = nameProblem(newName, null);
    if (problem) return setError(problem);
    const others = items.filter((i) => !i.isOther);
    const sortOrder = (others.at(-1)?.sortOrder ?? 0) + 10;
    run(async () => {
      const saved = await saveAssociationItem({ name: newName.replace(/\s+/g, " "), sortOrder });
      setItems((prev) => [...prev.filter((i) => !i.isOther), saved, ...prev.filter((i) => i.isOther)]);
      setNewName("");
    }, "Item added.");
  }

  function rename() {
    const problem = nameProblem(editing.name, editing.id);
    if (problem) return setError(problem);
    run(async () => {
      const saved = await saveAssociationItem({ id: editing.id, name: editing.name.replace(/\s+/g, " ") });
      setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
      setEditing(null);
    }, "Item renamed.");
  }

  function remove(item) {
    setPendingRemove(null);
    run(async () => {
      await removeAssociationItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }, "Item removed.");
  }

  return (
    <div className="agri-modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="agri-card agri-modal agri-modal-full" style={{ "--agri-modal-width": "480px" }} role="dialog" aria-label="Manage items" onClick={(e) => e.stopPropagation()}>
        <div className="agri-modal-header">
          <div className="agri-modal-title">Manage items</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={busy}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          <div className="agri-muted" style={{ fontSize: "0.78rem", marginBottom: 12 }}>
            The Farmers' Association President picks an association request's item from this list. Removing an item keeps it on past requests.
          </div>
          {(loadError || error) && <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 12, padding: "8px 12px" }}>{loadError || error}</div>}
          {!items && !loadError && <div className="agri-muted">Loading…</div>}
          {items && (
            <ul className="agri-item-list">
              {items.map((i) => (
                <li key={i.id}>
                  {editing?.id === i.id ? (
                    <>
                      <input className="form-control form-control-sm" aria-label={`New name for ${i.name}`} maxLength={MAX_NAME} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} disabled={busy} autoFocus />
                      <button type="button" className="agri-icon-btn" aria-label="Save name" onClick={rename} disabled={busy}><Check size={14} /></button>
                      <button type="button" className="agri-icon-btn" aria-label="Cancel rename" onClick={() => setEditing(null)} disabled={busy}><X size={14} /></button>
                    </>
                  ) : (
                    <>
                      <span className="agri-item-name">{i.name}</span>
                      <button type="button" className="agri-icon-btn" aria-label={`Rename ${i.name}`} onClick={() => { setError(""); setEditing({ id: i.id, name: i.name }); }} disabled={busy}><Pencil size={14} /></button>
                      {!i.isOther && (
                        <button type="button" className="agri-icon-btn agri-type-remove" aria-label={`Remove ${i.name}`} onClick={() => setPendingRemove(i)} disabled={busy}><Trash2 size={14} /></button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {items && (
            <form className="agri-item-add" onSubmit={add} noValidate>
              <input className="form-control form-control-sm" placeholder="New item, e.g. Drone sprayer" aria-label="New item name" maxLength={MAX_NAME} value={newName} onChange={(e) => setNewName(e.target.value)} disabled={busy} />
              <button type="submit" className="btn btn-agri-primary btn-sm d-inline-flex align-items-center gap-1" disabled={busy}><Plus size={14} /> Add item</button>
            </form>
          )}
        </div>
        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={busy}>Done</button>
        </div>
      </div>
      {pendingRemove && (
        <ConfirmDialog
          title={`Remove ${pendingRemove.name}?`}
          message="It won't be offered for new association requests. Past requests keep it."
          confirmLabel="Remove"
          onConfirm={() => remove(pendingRemove)}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}
