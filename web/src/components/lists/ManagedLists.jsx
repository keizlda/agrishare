import { useEffect, useState } from "react";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import Toast from "../ui/Toast.jsx";
import { LISTS, addEntry, deleteEntry, listAllEntries, listUsage, renameEntry, setEntryActive } from "../../lib/api/lists.js";
import { MAX_LIST_NAME, checkName, cleanName } from "../../lib/listMatch.js";
import { friendlyError } from "../../lib/friendlyError.js";

// Types of farmer took the place of the crops list (Nov 26, 2026): farmers
// are classified by type, no longer by a single crop.
const KINDS = ["sitios", "associations", "farmerTypes", "barangays"];
// Sitios/puroks and farmers' associations belong to a barangay.
const PER_BARANGAY = new Set(["sitios", "associations"]);
// Types of farmer keep their order (new ones at the end); the rest by name.
const sortFor = (kind) => (list) =>
  [...list].sort((a, b) => (kind === "farmerTypes" ? a.sortOrder - b.sortOrder : 0) || a.name.localeCompare(b.name));
const PLACEHOLDERS = {
  sitios: "New sitio/purok, e.g. Purok 6",
  associations: "New association name",
  farmerTypes: "New type, e.g. Bee farmer",
  barangays: "New barangay name",
};

// Settings → Lists (MAO Admin): the sitios/puroks, farmers' associations,
// types of farmer and barangays the farmer form (and, for barangays, the Create post
// window) offers. Add, rename, deactivate / reactivate; an entry no farmer
// uses can be deleted (the database refuses deleting one that's in use).
// Barangays are never deleted, only deactivated.
export default function ManagedLists() {
  const [lists, setLists] = useState(null);
  const [usage, setUsage] = useState({ sitios: {}, associations: {}, farmerTypes: {}, barangays: {} });
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState(null);
  const [barangayId, setBarangayId] = useState("all");

  useEffect(() => {
    Promise.all([listAllEntries(), listUsage().catch(() => null)])
      .then(([l, u]) => {
        setLists(l);
        if (u) setUsage(u);
      })
      .catch((err) => setLoadError(friendlyError(err, "Couldn't load the lists.")));
  }, []);

  const replace = (kind, entry) => setLists((l) => ({ ...l, [kind]: sortFor(kind)([...l[kind].filter((e) => e.id !== entry.id), entry]) }));
  const remove = (kind, id) => setLists((l) => ({ ...l, [kind]: l[kind].filter((e) => e.id !== id) }));

  if (loadError) return <div className="agri-pill red" style={{ display: "block", padding: "8px 12px" }}>{loadError}</div>;
  const barangayName = (id) => lists?.barangays.find((b) => b.id === id)?.name ?? "—";
  const scoped = (kind) => {
    const all = lists?.[kind] ?? null;
    if (!all || !PER_BARANGAY.has(kind) || barangayId === "all") return all;
    return all.filter((e) => String(e.barangayId) === barangayId);
  };

  return (
    <div className="agri-lists-wrap">
      <div className="agri-lists-scope">
        <label htmlFor="lists-barangay">Sitios / puroks and farmers&apos; associations of</label>
        <select id="lists-barangay" className="form-select form-select-sm" value={barangayId} onChange={(e) => setBarangayId(e.target.value)}>
          <option value="all">All barangays</option>
          {(lists?.barangays ?? []).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>
      </div>
    <div className="agri-lists-grid">
      {KINDS.map((kind) => (
        <ListCard
          key={kind}
          kind={kind}
          entries={scoped(kind)}
          barangayId={PER_BARANGAY.has(kind) ? barangayId : null}
          barangayName={barangayName}
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
    </div>
  );
}

// barangayId: for sitios/associations, the barangay shown ("all" lists every
// barangay's entries with their barangay, and adding needs one chosen).
function ListCard({ kind, entries, barangayId, barangayName, usage, onSaved, onDeleted }) {
  const perBarangay = barangayId != null;
  const mustChoose = perBarangay && barangayId === "all";
  const meta = LISTS[kind];
  const [newName, setNewName] = useState("");
  const [addNote, setAddNote] = useState(null); // { tone, text, similar?, same? }
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, name, examples, note }
  // Types of farmer also have examples ("palay, irrigated rice"), shown in
  // small gray text beside each type in the farmer form.
  const isTypes = kind === "farmerTypes";
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
      const extra = isTypes ? { sort_order: Math.max(0, ...entries.map((e) => e.sortOrder ?? 0)) + 1 } : {};
      const saved = await addEntry(kind, check.name, perBarangay ? barangayId : null, extra);
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
    const examples = isTypes ? cleanName(editing.examples ?? "") : null;
    const examplesChanged = isTypes && examples !== (entry.examples ?? "");
    if (cleanName(editing.name) === entry.name && !examplesChanged) {
      setEditing(null);
      return;
    }
    if (examples && examples.length > 200) {
      setEditing((x) => ({ ...x, note: { tone: "error", text: "Keep the examples to 200 characters or fewer." } }));
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
      const saved = await renameEntry(kind, entry.id, check.name, isTypes ? { examples: examples || null } : {});
      setEditing(null);
      onSaved(saved, saved.name === entry.name ? `“${saved.name}” saved.` : `Renamed to “${saved.name}”. Farmer records show the new name.`);
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
          placeholder={mustChoose ? "Choose a barangay above to add" : PLACEHOLDERS[kind]}
          aria-label={`New ${meta.noun}`}
          onChange={(e) => {
            setNewName(e.target.value);
            setAddNote(null);
          }}
          disabled={!entries || busy || mustChoose}
        />
        <button type="submit" className="btn btn-sm btn-agri-primary d-flex align-items-center gap-1" disabled={!entries || busy || mustChoose}>
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
                      onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value, note: null }))}
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
                  {isTypes && (
                    <input
                      className="form-control form-control-sm mt-1"
                      value={editing.examples ?? ""}
                      maxLength={220}
                      placeholder="Examples (optional), e.g. palay, irrigated rice"
                      aria-label={`Examples for ${entry.name}`}
                      onChange={(e) => setEditing((x) => ({ ...x, examples: e.target.value, note: null }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); saveRename(); }
                        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setEditing(null); }
                      }}
                      disabled={busy}
                    />
                  )}
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
                    <span className="agri-list-row-name">
                      {entry.name}
                      {isTypes && entry.examples && <span className="agri-list-row-examples">{entry.examples}</span>}
                    </span>
                    <span className="agri-list-row-meta">
                      {mustChoose && <span className="agri-pill gray">{barangayName(entry.barangayId)}</span>}
                      {uses ? `${uses} farmer${uses === 1 ? "" : "s"}` : "Not used"}
                      {!entry.isActive && <span className="agri-pill gray">Deactivated</span>}
                    </span>
                  </div>
                  <div className="agri-list-row-actions">
                    <button type="button" className="agri-icon-btn" aria-label={`Rename ${entry.name}`} title={isTypes ? "Edit" : "Rename"} onClick={() => setEditing({ id: entry.id, name: entry.name, examples: entry.examples ?? "", note: null })} disabled={busy}>
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
