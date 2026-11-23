import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Search, Settings2 } from "lucide-react";
import ManageCommoditiesModal from "./ManageCommoditiesModal.jsx";
import { CategorySelect, RateInput } from "./CommodityFields.jsx";
import { RATE_HINT, isKg, rateProblem, validateCommodity } from "../../lib/commodityRules.js";
import { saveCommodity } from "../../lib/api/commodities.js";
import { formatRate } from "../../lib/allocation.js";
import { friendlyError } from "../../lib/friendlyError.js";

const PANEL_MAX = 280;
const label = (c) => (c.rate > 0 && isKg(c.unit) ? `${c.name} · ${formatRate(c.rate)}` : c.name);

// The distribution form's Commodity field: a searchable dropdown ("Rice
// Seeds – Hybrid · 15 kg/ha"); its last option, "+ Add new commodity", opens
// a small form right here in the distribution window. Under it: the rate in
// use with "Edit rate" (asks whether the new rate is for future
// distributions too, or this distribution only) and "Manage commodities".
// Only the MAO Admin can add, edit or delete commodities (RLS does too).
//
// rate: the rate this distribution uses (the commodity's, or one chosen for
// this distribution only — `overridden`).
export default function CommodityPicker({
  id,
  commodities,
  allCommodities = commodities,
  value,
  onChange,
  rate,
  overridden = false,
  canManage = false,
  disabled = false,
  onAdded,
  onUpdated,
  onDeleted,
  onRateForThis,
}) {
  const selected = commodities.find((c) => String(c.id) === String(value)) ?? null;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const [adding, setAdding] = useState(null); // { name, category, rate }
  const [addErrors, setAddErrors] = useState({});
  const [editingRate, setEditingRate] = useState(null); // text
  const [rateError, setRateError] = useState("");
  const [askScope, setAskScope] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [managing, setManaging] = useState(false);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return commodities.filter((c) => !q || c.name.toLowerCase().includes(q) || String(c.category ?? "").toLowerCase().includes(q));
  }, [commodities, query]);
  const items = canManage ? [...options, { add: true }] : options;

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

  // Another commodity: its own rate, no half-finished rate edit.
  useEffect(() => {
    setEditingRate(null);
    setAskScope(false);
    setRateError("");
  }, [value]);

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
    setActive(Math.max(0, options.findIndex((c) => String(c.id) === String(value))));
    setOpen(true);
  }

  function choose(item) {
    setOpen(false);
    if (item.add) {
      setAdding({ name: query.trim(), category: "", rate: "" });
      setAddErrors({});
      setFormError("");
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

  async function saveNew() {
    const errors = validateCommodity(adding, allCommodities);
    setAddErrors(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setFormError("");
    try {
      const saved = await saveCommodity(null, { name: adding.name.trim().replace(/\s+/g, " "), category: adding.category, rate: adding.rate.trim() });
      setAdding(null);
      onAdded(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't add this commodity. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function startRateEdit() {
    setEditingRate(rate != null ? String(rate) : "");
    setRateError("");
    setAskScope(false);
    setFormError("");
  }

  function checkRate() {
    const text = editingRate.trim();
    const problem = !text ? "Enter the kg per hectare." : rateProblem(text, selected?.unit);
    setRateError(problem);
    if (problem) return;
    if (Number(text) === Number(rate) && !overridden) {
      setEditingRate(null);
      return;
    }
    setAskScope(true);
  }

  // Yes: the commodity's rate changes (future distributions too; logged in
  // the Activity Log by the database). No: this distribution only.
  async function applyRate(forFuture) {
    const value2 = Number(editingRate.trim());
    if (!forFuture) {
      onRateForThis(value2);
      setEditingRate(null);
      setAskScope(false);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const saved = await saveCommodity(selected.id, { name: selected.name, category: selected.category, rate: String(value2) });
      onUpdated(saved);
      setEditingRate(null);
      setAskScope(false);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't update the rate. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const canRate = canManage && selected && isKg(selected.unit);

  return (
    <div className="agri-combo-wrap">
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className="form-select agri-combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        disabled={disabled}
      >
        {selected ? (
          <span className="agri-combo-value">
            {selected.name}
            {selected.rate > 0 && isKg(selected.unit) && <span className="agri-combo-rate"> · {formatRate(selected.rate)}</span>}
          </span>
        ) : (
          <span className="agri-muted">{commodities.length ? "Choose a commodity" : "No commodities yet"}</span>
        )}
      </button>

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
              <input ref={searchRef} className="form-control form-control-sm" placeholder="Search commodities" aria-label="Search commodities" value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} />
            </div>
            <ul className="agri-combo-list" role="listbox" aria-label="Commodities">
              {options.length === 0 && <li className="agri-combo-empty">No commodity matches “{query}”.</li>}
              {items.map((item, i) =>
                item.add ? (
                  <li key="__add" role="option" aria-selected={i === active} className={`agri-combo-option agri-combo-add${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(item); }}>
                    <Plus size={14} /> Add new commodity
                  </li>
                ) : (
                  <li key={item.id} role="option" aria-selected={String(item.id) === String(value)} className={`agri-combo-option${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(item); }}>
                    <span className="agri-combo-option-name">{label(item)}</span>
                    {String(item.id) === String(value) && <Check size={14} />}
                  </li>
                ),
              )}
            </ul>
          </div>,
          document.body,
        )}

      {formError && <div className="invalid-feedback d-block" role="alert">{formError}</div>}

      {adding ? (
        <div className="agri-combo-addform" role="group" aria-label="Add new commodity">
          <div className="agri-combo-addform-title">Add new commodity</div>
          <label className="agri-form-label" htmlFor={`${id}-new-name`}>Name <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <input id={`${id}-new-name`} className={`form-control form-control-sm${addErrors.name ? " is-invalid" : ""}`} value={adding.name} onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} placeholder="e.g. Rice Seeds – Hybrid" disabled={busy} autoFocus />
          {addErrors.name && <div className="invalid-feedback d-block">{addErrors.name}</div>}
          <div className="row g-2 mt-0">
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor={`${id}-new-category`}>Category <span style={{ color: "var(--agri-red)" }}>*</span></label>
              <CategorySelect id={`${id}-new-category`} value={adding.category} onChange={(v) => setAdding((a) => ({ ...a, category: v }))} invalid={!!addErrors.category} disabled={busy} small />
              {addErrors.category && <div className="invalid-feedback d-block">{addErrors.category}</div>}
            </div>
            <div className="col-12 col-sm-6">
              <label className="agri-form-label" htmlFor={`${id}-new-rate`}>Allocation (kg per hectare)</label>
              <RateInput id={`${id}-new-rate`} value={adding.rate} onChange={(v) => setAdding((a) => ({ ...a, rate: v }))} invalid={!!addErrors.rate} disabled={busy} small />
              {addErrors.rate && <div className="invalid-feedback d-block">{addErrors.rate}</div>}
            </div>
          </div>
          <div className="agri-field-hint">{RATE_HINT}</div>
          <div className="agri-combo-addform-actions">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAdding(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-sm btn-agri-primary" onClick={saveNew} disabled={busy}>{busy ? "Saving…" : "Save commodity"}</button>
          </div>
        </div>
      ) : editingRate !== null ? (
        <div className="agri-combo-rate-edit">
          {askScope ? (
            <div className="agri-combo-ask" role="group" aria-label="Rate change">
              <div>Update this commodity&apos;s rate for future distributions too?</div>
              <div className="agri-combo-ask-actions">
                <button type="button" className="btn btn-sm btn-agri-primary" onClick={() => applyRate(true)} disabled={busy}>{busy ? "Saving…" : "Yes"}</button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => applyRate(false)} disabled={busy}>No, this distribution only</button>
                <button type="button" className="agri-link-btn" onClick={() => setAskScope(false)} disabled={busy}>Back</button>
              </div>
            </div>
          ) : (
            <>
              <div className="agri-combo-rate-row">
                <RateInput id={`${id}-rate`} value={editingRate} onChange={(v) => { setEditingRate(v); setRateError(""); }} invalid={!!rateError} small autoFocus label="Allocation in kg per hectare" />
                <button type="button" className="btn btn-sm btn-agri-primary" onClick={checkRate}>Save</button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setEditingRate(null)}>Cancel</button>
              </div>
              {rateError && <div className="invalid-feedback d-block">{rateError}</div>}
            </>
          )}
        </div>
      ) : (
        <div className="agri-combo-meta">
          <span>
            {selected ? (rate > 0 ? <>Allocation {formatRate(rate)}{overridden && <span className="agri-combo-override"> (this distribution only)</span>}</> : "No allocation per hectare") : ""}
            {canRate && (
              <button type="button" className="agri-link-btn" onClick={startRateEdit} disabled={disabled}>{rate > 0 ? "Edit rate" : "Set rate"}</button>
            )}
          </span>
          {canManage && (
            <button type="button" className="agri-link-btn agri-combo-manage" onClick={() => setManaging(true)} disabled={disabled}>
              <Settings2 size={12} /> Manage commodities
            </button>
          )}
        </div>
      )}

      {managing && (
        <ManageCommoditiesModal
          commodities={allCommodities}
          onClose={() => setManaging(false)}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
