import { COMMODITY_CATEGORIES } from "../../lib/api/commodities.js";

// Commodity form fields shared by the distribution form's commodity picker
// and the Manage commodities window (the rules: lib/commodityRules.js).

// Category dropdown. A stored category that isn't one of the choices (from
// before the list) stays selectable so editing doesn't change it.
export function CategorySelect({ id, value, onChange, invalid, disabled, small }) {
  const options = COMMODITY_CATEGORIES.includes(value) || !value ? COMMODITY_CATEGORIES : [value, ...COMMODITY_CATEGORIES];
  return (
    <select id={id} className={`form-select${small ? " form-select-sm" : ""}${invalid ? " is-invalid" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {!value && <option value="">Choose a category</option>}
      {options.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// "Allocation (kg per hectare)": a number with "kg/ha" shown inside, right.
export function RateInput({ id, value, onChange, invalid, disabled, small, autoFocus, label }) {
  return (
    <div className="agri-unit-input">
      <input
        id={id}
        inputMode="decimal"
        className={`form-control${small ? " form-control-sm" : ""} text-end${invalid ? " is-invalid" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="e.g. 40"
        autoFocus={autoFocus}
        aria-label={label}
      />
      <span className="agri-unit-input-unit" aria-hidden="true">kg/ha</span>
    </div>
  );
}
