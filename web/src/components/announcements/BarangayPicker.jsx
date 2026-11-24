import { useId, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { nameKey } from "../../lib/listMatch.js";

// "Choose barangays": a search box that adds barangays as removable chips.
// `barangays`: the list (Settings → Lists); only active ones can be added,
// but a chosen one that was deactivated since stays until it's removed.
// `value`: the chosen ids, in the order they were added.
export default function BarangayPicker({ barangays, value, onChange, invalid, disabled }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listId = useId();

  const byId = useMemo(() => new Map(barangays.map((b) => [b.id, b])), [barangays]);
  const chosen = value.map((id) => byId.get(id) ?? { id, name: "Barangay", isActive: false });
  const options = useMemo(() => {
    const k = nameKey(query);
    return barangays.filter((b) => b.isActive && !value.includes(b.id) && nameKey(b.name).includes(k));
  }, [barangays, value, query]);

  // The list closes after each pick so it never covers the chips; typing,
  // a click in the box or ↓ opens it again.
  function add(b) {
    if (!b) return;
    onChange([...value, b.id]);
    setQuery("");
    setActive(0);
    setOpen(false);
    inputRef.current?.focus();
  }

  function remove(id) {
    onChange(value.filter((x) => x !== id));
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open) add(options[active]);
      else setOpen(true);
    } else if (e.key === "Escape" && open) {
      // Close the list, not the window.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="agri-brgy-picker">
      <div className="agri-brgy-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          className={`form-control${invalid ? " is-invalid" : ""}`}
          placeholder="Search barangays"
          aria-label="Search barangays"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          autoComplete="off"
        />
        {open && (
          <ul className="agri-brgy-options" id={listId} role="listbox" aria-label="Barangays">
            {options.length === 0 ? (
              <li className="agri-brgy-empty">{query ? "No barangay matches that." : "Every barangay is already added."}</li>
            ) : (
              options.map((b, i) => (
                <li
                  key={b.id}
                  id={`${listId}-${b.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={`agri-brgy-option${i === active ? " active" : ""}`}
                  // Keep the focus in the box while a barangay is clicked.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add(b)}
                >
                  {b.name}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {chosen.length > 0 && (
        <div className="agri-brgy-chips" aria-label="Chosen barangays">
          {chosen.map((b) => (
            <span key={b.id} className="agri-brgy-chip">
              {b.name}
              {!b.isActive && <span className="agri-muted"> (deactivated)</span>}
              <button type="button" aria-label={`Remove ${b.name}`} onClick={() => remove(b.id)} disabled={disabled}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
