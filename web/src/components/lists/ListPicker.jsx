import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Search, X } from "lucide-react";
import { LISTS, addEntry } from "../../lib/api/lists.js";
import { MAX_LIST_NAME, checkName, cleanName } from "../../lib/listMatch.js";
import { friendlyError } from "../../lib/friendlyError.js";

const PANEL_MAX = 280;

// A dropdown for a managed list (sitios/puroks, farmers' associations): type
// to search; the last option, "+ Add new …", opens a small input right
// under the field (no second pop-up). Before adding, it checks for the same
// name (ignoring case and spaces) and for a similar one ("Did you mean
// Purok 1?"). Deactivated entries aren't offered, except the one already
// chosen.
//
// value: the chosen entry's id ("" for none). legacyText: an older value
// that isn't on the list (shown until something is chosen).
export default function ListPicker({
  id,
  kind,
  entries,
  value,
  onChange,
  onAdded,
  canAdd = false,
  optional = false,
  invalid = false,
  disabled = false,
  legacyText = "",
  placeholder,
  ariaLabel,
  barangayId = null,
}) {
  const meta = LISTS[kind];
  const selected = entries.find((e) => String(e.id) === String(value)) ?? null;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const [adding, setAdding] = useState(null); // text being typed, or null
  const [addError, setAddError] = useState("");
  const [similar, setSimilar] = useState(null); // entry that looks like the new name
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => (e.isActive || String(e.id) === String(value)) && (!q || e.name.toLowerCase().includes(q)));
  }, [entries, query, value]);
  const items = canAdd ? [...options, { add: true }] : options;

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (panelRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onScroll(e) {
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  function toggle() {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const up = below < 200 && r.top > below;
    setPos({ left: r.left, width: r.width, top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined, max: Math.min(PANEL_MAX, Math.max(160, up ? r.top - 12 : below)) });
    setQuery("");
    setActive(Math.max(0, options.findIndex((e) => String(e.id) === String(value))));
    setOpen(true);
  }

  function choose(item) {
    setOpen(false);
    if (item.add) {
      setAdding(query.trim());
      setAddError("");
      setSimilar(null);
      return;
    }
    onChange(String(item.id));
    triggerRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[active]) choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  function use(entry) {
    setAdding(null);
    setSimilar(null);
    setAddError("");
    onChange(String(entry.id));
  }

  // anyway: the admin saw the "similar name" warning and adds it regardless.
  async function saveNew(anyway = false) {
    const check = checkName(entries, adding, { anyway });
    if (check.error) {
      // The same name: offer to use it (or say it's deactivated).
      setSimilar(check.same?.isActive ? check.same : null);
      setAddError(check.same && !check.same.isActive ? `${check.error} The MAO Admin can reactivate it in Settings.` : check.error);
      return;
    }
    if (check.similar) {
      setSimilar(check.similar);
      setAddError("");
      return;
    }
    setBusy(true);
    setAddError("");
    try {
      const saved = await addEntry(kind, check.name, barangayId);
      setAdding(null);
      setSimilar(null);
      onAdded(saved);
      onChange(String(saved.id));
    } catch (err) {
      setAddError(friendlyError(err, `Couldn't add this ${meta.noun}. Please try again.`));
    } finally {
      setBusy(false);
    }
  }

  const similarText = similar && !addError
    ? kind === "associations"
      ? `A similar association already exists: ${similar.name}.`
      : `Did you mean ${similar.name}?`
    : "";

  return (
    <div className="agri-combo-wrap">
      <div className="agri-combo-field">
        <button
          type="button"
          id={id}
          ref={triggerRef}
          className={`form-select agri-combo-trigger${invalid ? " is-invalid" : ""}${optional && (selected || legacyText) ? " agri-combo-clearable" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={toggle}
          disabled={disabled}
        >
          {selected ? (
            <span className="agri-combo-value">
              {selected.name}
              {!selected.isActive && <span className="agri-muted"> (deactivated)</span>}
            </span>
          ) : legacyText ? (
            <span className="agri-combo-value">
              {legacyText} <span className="agri-muted">(not on the list)</span>
            </span>
          ) : (
            <span className="agri-muted">{placeholder ?? meta.placeholder}</span>
          )}
        </button>
        {optional && (selected || legacyText) && !disabled && (
          <button type="button" className="agri-combo-clear" aria-label={`Clear ${meta.noun}`} onClick={() => onChange("")}>
            <X size={14} />
          </button>
        )}
      </div>

      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            className="agri-combo-panel"
            style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.max }}
            onKeyDown={onKeyDown}
          >
            <div className="agri-combo-search">
              <Search size={14} />
              <input ref={searchRef} className="form-control form-control-sm" placeholder={`Search ${meta.title.toLowerCase()}`} aria-label={`Search ${meta.title.toLowerCase()}`} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} />
            </div>
            <ul className="agri-combo-list" role="listbox" aria-label={meta.title}>
              {options.length === 0 && <li className="agri-combo-empty">{query ? `Nothing matches “${query}”.` : "The list is empty."}</li>}
              {items.map((item, i) =>
                item.add ? (
                  <li key="__add" role="option" aria-selected={i === active} className={`agri-combo-option agri-combo-add${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(item); }}>
                    <Plus size={14} /> {meta.addLabel}
                  </li>
                ) : (
                  <li key={item.id} role="option" aria-selected={String(item.id) === String(value)} className={`agri-combo-option${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(item); }}>
                    <span className="agri-combo-option-name">{item.name}{!item.isActive && <span className="agri-muted"> (deactivated)</span>}</span>
                    {String(item.id) === String(value) && <Check size={14} />}
                  </li>
                ),
              )}
            </ul>
          </div>,
          document.body,
        )}

      {adding !== null && (
        <div className="agri-combo-addform agri-list-addform" role="group" aria-label={meta.addLabel}>
          <div className="agri-list-addrow">
            <input
              id={`${id}-new`}
              className={`form-control form-control-sm${addError ? " is-invalid" : ""}`}
              value={adding}
              maxLength={MAX_LIST_NAME + 20}
              placeholder={kind === "associations" ? "Association name" : "e.g. Purok 6"}
              aria-label={`New ${meta.noun}`}
              onChange={(e) => { setAdding(e.target.value); setAddError(""); setSimilar(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveNew(); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAdding(null); } }}
              disabled={busy}
              autoFocus
            />
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAdding(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-sm btn-agri-primary" onClick={() => saveNew()} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {addError && (
            <div className="agri-list-note error" role="alert">
              {addError}
              {similar && <button type="button" className="agri-link-btn" onClick={() => use(similar)}>Use {similar.name}</button>}
            </div>
          )}
          {similarText && (
            <div className="agri-list-note warn" role="alert">
              {similarText}
              <span className="agri-list-note-actions">
                <button type="button" className="agri-link-btn" onClick={() => use(similar)}>Use {similar.name}</button>
                <button type="button" className="agri-link-btn" onClick={() => saveNew(true)} disabled={busy}>Add “{cleanName(adding)}” anyway</button>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
