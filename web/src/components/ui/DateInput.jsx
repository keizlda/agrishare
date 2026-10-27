import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";
import { isoToTyped, maskTypedDate, typedToIso } from "../../lib/dates.js";

// A date field typed MM/DD/YYYY (the slashes fill in while typing), with a
// calendar button for picking one instead. The browser's own date box
// follows the device's region and can show DD/MM/YYYY; this one reads
// month-day-year on every device. `value` and `onChange` use "YYYY-MM-DD",
// like a native date input — "" while the field is empty or not yet a real
// date.
export default function DateInput({ value, onChange, min, max, required, disabled, invalid, id, className = "", style, "aria-label": ariaLabel }) {
  const [text, setText] = useState(() => isoToTyped(value));
  const inputRef = useRef(null);

  // Follow changes from outside (a reset, a record loaded for editing), but
  // keep a half-typed date — it maps to "" until it's complete.
  useEffect(() => {
    setText((current) => ((typedToIso(current) ?? "") === (value ?? "") ? current : isoToTyped(value)));
  }, [value]);

  const iso = typedToIso(text);
  const outOfRange = !!iso && ((min && iso < min) || (max && iso > max));
  const showInvalid = invalid || (text.length === 10 && (!iso || outOfRange));

  // Lets a form's own validation (required, submit) catch a partial or
  // impossible date such as 02/30/2026.
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      text && !iso ? "Enter the date as MM/DD/YYYY." : outOfRange ? "Enter a date within the allowed range." : "",
    );
  }, [text, iso, outOfRange]);

  function handleType(e) {
    const next = maskTypedDate(e.target.value);
    setText(next);
    onChange(typedToIso(next) ?? "");
  }

  function handlePick(e) {
    setText(isoToTyped(e.target.value));
    onChange(e.target.value);
  }

  return (
    <div className="agri-date-input" style={style}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM/DD/YYYY"
        maxLength={10}
        className={`form-control${showInvalid ? " is-invalid" : ""}${className ? ` ${className}` : ""}`}
        value={text}
        onChange={handleType}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      {/* The browser's date picker, invisible, laid over the calendar icon. */}
      <input
        type="date"
        className="agri-date-input-picker"
        tabIndex={-1}
        aria-hidden="true"
        value={iso ?? ""}
        min={min}
        max={max}
        disabled={disabled}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // Already open, or a browser without showPicker — tapping the
            // field opens it there anyway.
          }
        }}
        onChange={handlePick}
      />
      <span className="agri-date-input-icon" aria-hidden="true">
        <Calendar size={16} />
      </span>
    </div>
  );
}
