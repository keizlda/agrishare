// Types of farmer: small chips (Farmers table, profile, beneficiary rows) and
// the two-column checklist in Add/Edit Farmer. The types come from the
// farmer_types list (Settings → Lists), never from the code.

export function TypeChips({ types, max = Infinity, empty = "—" }) {
  if (!types?.length) return <span className="agri-muted">{empty}</span>;
  const shown = types.slice(0, max);
  const more = types.length - shown.length;
  return (
    <span className="agri-type-chips" title={types.map((t) => t.name).join(", ")}>
      {shown.map((t) => (
        <span key={t.id} className="agri-type-chip">{t.name}</span>
      ))}
      {more > 0 && <span className="agri-type-chip more">+{more}</span>}
    </span>
  );
}

// options: the farmer types ({ id, name, examples, isActive }); value: the
// chosen ids (strings). A deactivated type stays listed when it's chosen.
export function TypeChecklist({ id, options, value, onChange, invalid, disabled }) {
  const chosen = new Set(value);
  const shown = options.filter((t) => t.isActive || chosen.has(String(t.id)));
  function toggle(typeId) {
    const key = String(typeId);
    onChange(chosen.has(key) ? value.filter((v) => v !== key) : [...value, key]);
  }
  return (
    <div id={id} className={`agri-type-checklist${invalid ? " is-invalid" : ""}`} role="group" aria-label="Type of farmer">
      {shown.map((t) => (
        <label key={t.id} className="agri-type-option">
          <input type="checkbox" className="form-check-input" checked={chosen.has(String(t.id))} onChange={() => toggle(t.id)} disabled={disabled} />
          <span className="agri-type-option-text">
            <span className="agri-type-option-name">{t.name}{t.isActive ? "" : " (deactivated)"}</span>
            {t.examples && <span className="agri-type-option-examples">{t.examples}</span>}
          </span>
        </label>
      ))}
      {shown.length === 0 && <div className="agri-muted">No types of farmer yet. The MAO Admin adds them in Settings → Lists.</div>}
    </div>
  );
}
