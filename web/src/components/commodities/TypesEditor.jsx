import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import ConfirmDialog from "../ui/ConfirmDialog.jsx";
import { newTypeKey } from "../../lib/commodityTypeRows.js";

// "Types and rates" rows: name, kg per hectare, Default, Remove — and
// "+ Add type". Removing a saved type asks first (past distributions keep it).
export default function TypesEditor({ rows, onChange, errors = {}, disabled, idPrefix = "type" }) {
  const [pendingRemove, setPendingRemove] = useState(null);
  const live = rows.filter((r) => !r.removed);

  function update(key, patch) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : patch.isDefault ? { ...r, isDefault: false } : r)));
  }
  function remove(row) {
    if (row.id) setPendingRemove(row);
    else onChange(rows.filter((r) => r.key !== row.key));
  }
  function add() {
    onChange([...rows, { key: newTypeKey(), id: null, name: "", rate: "", isDefault: live.length === 0, removed: false }]);
  }

  return (
    <div className="agri-types-editor">
      {live.length === 0 && <div className="agri-field-hint" style={{ marginTop: 0 }}>No types yet. Without a type, distributions split the total equally.</div>}
      {live.map((r, i) => (
        <div key={r.key} className="agri-type-row">
          <div className="agri-type-name">
            <input
              id={`${idPrefix}-name-${i}`}
              className={`form-control form-control-sm${errors[r.key]?.name ? " is-invalid" : ""}`}
              aria-label={`Type ${i + 1} name`}
              placeholder="e.g. Inbred (RCEF)"
              maxLength={60}
              value={r.name}
              onChange={(e) => update(r.key, { name: e.target.value })}
              disabled={disabled}
            />
            {errors[r.key]?.name && <div className="invalid-feedback d-block">{errors[r.key].name}</div>}
          </div>
          <div className="agri-type-rate">
            <div className="agri-unit-input">
              <input
                id={`${idPrefix}-rate-${i}`}
                inputMode="decimal"
                className={`form-control form-control-sm${errors[r.key]?.rate ? " is-invalid" : ""}`}
                aria-label={`Type ${i + 1} rate in kg per hectare`}
                placeholder="e.g. 40"
                value={r.rate}
                onChange={(e) => update(r.key, { rate: e.target.value })}
                disabled={disabled}
              />
              <span className="agri-unit-input-unit" aria-hidden="true">kg/ha</span>
            </div>
            {errors[r.key]?.rate && <div className="invalid-feedback d-block">{errors[r.key].rate}</div>}
          </div>
          <label className="agri-type-default" title="Used when a farmer has no type">
            <input type="radio" name={`${idPrefix}-default`} checked={!!r.isDefault} onChange={() => update(r.key, { isDefault: true })} disabled={disabled} />
            Default
          </label>
          <button type="button" className="agri-icon-btn agri-type-remove" aria-label={`Remove ${r.name || "this type"}`} onClick={() => remove(r)} disabled={disabled}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1 mt-1" onClick={add} disabled={disabled}>
        <Plus size={14} /> Add type
      </button>
      {pendingRemove && (
        <ConfirmDialog
          title={`Remove ${pendingRemove.name}?`}
          message="It won't be offered for new distributions or requests. Past distributions keep it. Takes effect when you save."
          confirmLabel="Remove"
          onConfirm={() => {
            const row = pendingRemove;
            setPendingRemove(null);
            onChange(rows.map((r) => (r.key === row.key ? { ...r, removed: true, isDefault: false } : r)));
          }}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </div>
  );
}
