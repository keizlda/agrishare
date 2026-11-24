import { useEffect, useState } from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import Toast from "../ui/Toast.jsx";
import { LISTS, addEntry, deleteEntry, listAllEntries, listUsage, renameEntry, setEntryActive } from "../../lib/api/lists.js";
import { MAX_LIST_NAME, checkName, cleanName } from "../../lib/listMatch.js";
import { friendlyError } from "../../lib/friendlyError.js";

const KINDS = ["sitios", "associations", "crops", "barangays"];
const sortByName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name));
const PLACEHOLDERS = {
  sitios: "New sitio/purok, e.g. Purok 6",
  associations: "New association name",
  crops: "New crop, e.g. Cassava",
  barangays: "New barangay name",
};

// Settings → Lists (MAO Admin): the sitios/puroks, farmers' associations,
// crops and barangays the farmer form (and, for barangays, the Create post
// window) offers. Add, rename, deactivate / reactivate; an entry no farmer
// uses can be deleted (the database refuses deleting one that's in use).
// Barangays are never deleted, only deactivated.
export default function ManagedLists() {
  const [lists, setLists] = useState(null);
  const [usage, setUsage] = useState({ sitios: {}, associations: {}, crops: {}, barangays: {} });
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([listAllEntries(), listUsage().catch(() => null)])
      .then(([l, u]) => {
        setLists(l);
        if (u) setUsage(u);
      })
      .catch((err) => setLoadError(friendlyError(err, "Couldn't load the lists.")));
  }, []);

  const replace = (kind, entry) => setLists((l) => ({ ...l, [kind]: sortByName([...l[kind].filter((e) => e.id !== entry.id), entry]) }));
  const remove = (kind, id) => setLists((l) => ({ ...l, [kind]: l[kind].filter((e) => e.id !== id) }));

  if (loadError) return <div className="agri-pill red" style={{ display: "block", padding: "8px 12px" }}>{loadError}</div>;

  return (
    <div className="agri-lists-grid">
      {KINDS.map((kind) => (
        <ListCard
          key={kind}
          kind={kind}
          entries={lists?.[kind] ?? null}
          usage={usage[kind]}
          onSaved={(entry, message) => {
            replace(kind, entry);
            setToast({ tone: "success", message });
          }}
          onDeleted={(entry) => {
            remove(kind, entry.id);
            setToast({ tone: "success", message: `“${entry.name}” deleted.` });
          }}
        />
      ))}
      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

function ListCard({ kind, entries, usage, onSaved, onDeleted }) {
  const meta = LISTS[kind];
  const [newName, setNewName] = useState("");
  const [addNote, setAddNote] = useState(null); // { tone, text, similar?, same? }
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name, note }
  const [pendingDelete, setPendingDelete] = useState(null);
  const [rowError, setRowError] = useState(null); // { id, text }

  const active = entries?.filter((e) => e.isActive).length ?? 0;
  const inactive = (entries?.length ?? 0) - active;

  async function add(anyway = false) {
    const check = checkName(entries, newName, { anyway });
    if (check.error) {
      setAddNote({ tone: "error", text: check.error, same: check.same && !check.same.isActive ? check.same : null });
      return;
    }
    if (check.similar) {
      setAddNote({ tone: "warn", text: kind === "associations" ? `A similar association already exists: ${check.similar.name}.` : `Did you mean ${check.similar.name}?`, similar: check.similar });
      return;
    }
    setBusy(true);
    try {
      const saved = await addEntry(kind, check.name);
      setNewName("");
      setAddNote(null);
      onSaved(saved, `“${saved.name}” added.`);
    } catch (err) {
      setAddNote({ tone: "error", text: friendlyError(err, `Couldn't add this ${meta.noun}.`) });
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(anyway = false) {
    const entry = entries.find((e) => e.id === editing.id);
    if (cleanName(editing.name) === entry.name) {
      setEditing(null);
      return;
    }
    const check = checkName(entries, editing.name, { exceptId: entry.id, anyway });
    if (check.error) {
      setEditing((x) => ({ ...x, note: { tone: "error", text: check.error } }));
      return;
    }
    if (check.similar) {
      setEditing((x) => ({ ...x, note: { tone: "warn", text: `Looks like ${check.similar.name}.`, similar: check.similar } }));
      return;
    }
    setBusy(true);
    try {
      const saved = await renameEntry(kind, entry.id, check.name);
      setEditing(null);
      onSaved(saved, `Renamed to “${saved.name}”. Farmer records show the new name.`);
    } catch (err) {
      setEditing((x) => ({ ...x, note: { tone: "error", text: friendlyError(err, "Couldn't rename it.") } }));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(entry) {
    setBusy(true);
    setRowError(null);
    try {
      const saved = await setEntryActive(kind, entry.id, !entry.isActive);
      onSaved(saved, saved.isActive ? `“${saved.name}” is active again.` : `“${saved.name}” deactivated. It's no longer offered; farmers who have it keep it.`);
    } catch (err) {
      setRowError({ id: entry.id, text: friendlyError(err, "Couldn't change it.") });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const entry = pendingDelete;
    setBusy(true);
    setRowError(null);
    try {
      await deleteEntry(kind, entry.id);
      onDeleted(entry);
    } catch (err) {
      setRowError({ id: entry.id, text: friendlyError(err, "Couldn't delete it.") });
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  return (
    <section className="agri-card agri-list-card" aria-label={meta.title}>
      <div className="agri-list-card-head">
        <div style={{ fontWeight: 700 }}>{meta.title}</div>
        <div className="agri-muted" style={{ fontSize: "0.74rem" }}>
          {entries ? `${active} active${inactive ? ` · ${inactive} deactivated` : ""}` : "Loading…"}
        </div>
      </div>

      <form
        className="agri-list-addrow"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className={`form-control form-control-sm${addNote?.tone === "error" ? " is-invalid" : ""}`}
          value={newName}
          maxLength={MAX_LIST_NAME + 20}
          placeholder={PLACEHOLDERS[kind]}
          aria-label={`New ${meta.noun}`}
          onChange={(e) => {
            setNewName(e.target.value);
            setAddNote(null);
          }}
          disabled={!entries || busy}
        />
        <button type="submit" className="btn btn-sm btn-agri-primary d-flex align-items-center gap-1" disabled={!entries || busy}>
          <Plus size={14} /> Add
        </button>
      </form>
      {addNote && (
        <div className={`agri-list-note ${addNote.tone}`} role="alert">
          {addNote.text}
          {addNote.same && (
            <button type="button" className="agri-link-btn" onClick={() => { setAddNote(null); setNewName(""); toggle(addNote.same); }} disabled={busy}>
              Reactivate it
            </button>
          )}
          {addNote.similar && (
            <button type="button" className="agri-link-btn" onClick={() => add(true)} disabled={busy}>
              Add “{cleanName(newName)}” anyway
            </button>
          )}
        </div>
      )}

      <ul className="agri-list-rows">
        {entries?.length === 0 && <li className="agri-muted agri-list-empty">Nothing on this list yet.</li>}
        {entries?.map((entry) => {
          const uses = usage?.[entry.id] ?? 0;
          const isEditing = editing?.id === entry.id;
          return (
            <li key={entry.id} className={`agri-list-row${entry.isActive ? "" : " inactive"}`}>
              {isEditing ? (
                <div className="agri-list-rename">
                  <div className="agri-list-addrow">
                    <input
                      className={`form-control form-control-sm${editing.note?.tone === "error" ? " is-invalid" : ""}`}
                      value={editing.name}
                      maxLength={MAX_LIST_NAME + 20}
                      aria-label={`Rename ${entry.name}`}
                      onChange={(e) => setEditing({ id: entry.id, name: e.target.value, note: null })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); saveRename(); }
                        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                      }}
                      disabled={busy}
                      autoFocus
                    />
                    <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                    <button type="button" className="btn btn-sm btn-agri-primary" onClick={() => saveRename()} disabled={busy} aria-label={`Save name of ${entry.name}`}>Save</button>
                  </div>
                  {editing.note && (
                    <div className={`agri-list-note ${editing.note.tone}`} role="alert">
                      {editing.note.text}
                      {editing.note.similar && <button type="button" className="agri-link-btn" onClick={() => saveRename(true)} disabled={busy}>Rename anyway</button>}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="agri-list-row-main">
                    <span className="agri-list-row-name">{entry.name}</span>
                    <span className="agri-list-row-meta">
                      {uses ? `${uses} farmer${uses === 1 ? "" : "s"}` : "Not used"}
                      {!entry.isActive && <span className="agri-pill gray">Deactivated</span>}
                    </span>
                  </div>
                  <div className="agri-list-row-actions">
                    <button type="button" className="agri-icon-btn" aria-label={`Rename ${entry.name}`} title="Rename" onClick={() => setEditing({ id: entry.id, name: entry.name, note: null })} disabled={busy}>
                      <Pencil size={14} />
                    </button>
                    <button type="button" className="agri-icon-btn" aria-label={`${entry.isActive ? "Deactivate" : "Reactivate"} ${entry.name}`} title={entry.isActive ? "Deactivate" : "Reactivate"} onClick={() => toggle(entry)} disabled={busy}>
                      <Power size={14} />
                    </button>
                    {meta.noDelete ? null : uses === 0 ? (
                      <button type="button" className="agri-icon-btn agri-type-remove" aria-label={`Delete ${entry.name}`} title="Delete" onClick={() => setPendingDelete(entry)} disabled={busy}>
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <span className="agri-list-action-spacer" aria-hidden="true" />
                    )}
                  </div>
                </>
              )}
              {rowError?.id === entry.id && <div className="agri-list-note error" role="alert">{rowError.text}</div>}
            </li>
          );
        })}
      </ul>
      <div className="agri-muted agri-list-foot">
        {meta.noDelete
          ? "Barangays can't be deleted; deactivate one to stop offering it (farmers and posts that have it keep it)."
          : "Used entries can't be deleted; deactivate them instead (farmers who have one keep it)."}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          message={`No farmer uses it. It will be removed from the ${meta.title.toLowerCase()} list.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </section>
  );
}
