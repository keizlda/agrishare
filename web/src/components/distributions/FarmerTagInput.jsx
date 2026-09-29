import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Pill from "../ui/Pill.jsx";
import { searchFarmers } from "../../lib/api/farmers.js";

// Gmail-style farmer tagging: type a name/RSBSA/@name, pick from a debounced
// dropdown (avatar-less initial circle, name, RSBSA, barangay, status
// badges), Enter/click to add, chip ✕ or Backspace-on-empty to remove.
// Inactive/unvalidated farmers can still be added but need a confirm step —
// handled by the parent via onRequestAdd's return value (see Distributions.jsx).
export default function FarmerTagInput({ taggedFarmers, onAddFarmer, onRemoveFarmer, disabled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const term = query.replace(/^@/, "").trim();
    if (!term) {
      setResults([]);
      setOpen(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchFarmers(term)
        .then((rows) => {
          const taggedIds = new Set(taggedFarmers.map((f) => f.farmerId));
          setResults(rows.filter((r) => !taggedIds.has(r.id)));
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function selectFarmer(farmer) {
    onAddFarmer(farmer);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e) {
    if (e.key === "Backspace" && query === "" && taggedFarmers.length > 0) {
      onRemoveFarmer(taggedFarmers[taggedFarmers.length - 1].farmerId);
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[activeIndex] ?? results[0];
      if (pick) selectFarmer(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div className="agri-tag-input" onClick={() => inputRef.current?.focus()}>
        {taggedFarmers.map((f) => (
          <span key={f.farmerId} className={`agri-tag-chip${f.duplicateWarning ? " warn" : ""}`}>
            {f.firstName} {f.lastName}
            <button
              type="button"
              aria-label={`Remove ${f.firstName} ${f.lastName}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveFarmer(f.farmerId);
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="agri-tag-input-field"
          placeholder={taggedFarmers.length === 0 ? "Type a name, RSBSA number, or @name…" : "Add another…"}
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
      </div>

      {open && (
        <div className="agri-tag-suggestions" role="listbox">
          {searching && <div className="agri-tag-suggestion-empty">Searching…</div>}
          {!searching && results.length === 0 && <div className="agri-tag-suggestion-empty">No matching farmers.</div>}
          {results.map((f, i) => (
            <button
              type="button"
              key={f.id}
              role="option"
              aria-selected={i === activeIndex}
              className={`agri-tag-suggestion${i === activeIndex ? " active" : ""}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => selectFarmer(f)}
            >
              <span className="agri-tag-suggestion-avatar">{f.firstName[0]}{f.lastName[0]}</span>
              <span className="agri-tag-suggestion-info">
                <span className="agri-tag-suggestion-name">{f.firstName} {f.lastName}</span>
                <span className="agri-tag-suggestion-meta">RSBSA {f.rsbsaNo} · {f.barangay}</span>
              </span>
              <span className="agri-tag-suggestion-badges">
                <Pill status={f.status} />
                <Pill status={f.validationStatus} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
