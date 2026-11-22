import { useEffect, useState } from "react";
import Pill from "../ui/Pill.jsx";
import FarmerAvatar from "../ui/FarmerAvatar.jsx";
import { searchFarmers } from "../../lib/api/farmers.js";
import { formatHectares } from "../../lib/allocation.js";
import { friendlyError } from "../../lib/friendlyError.js";

// Pick one farmer by name or RSBSA number (typeahead). Shows the picked
// farmer as a card with a Change button.
export default function FarmerSearchField({ id, farmer, onPick, disabled, locked = false, invalid = false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    const term = query.trim();
    if (!term || farmer) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchFarmers(term)
        .then((rows) => {
          setResults(rows);
          setSearchError("");
        })
        .catch((err) => setSearchError(friendlyError(err, "Couldn't search farmers. Please try again.")))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, farmer]);

  if (farmer) {
    return (
      <div className="agri-picked-farmer">
        <FarmerAvatar url={farmer.avatarUrl} firstName={farmer.firstName} lastName={farmer.lastName} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="agri-beneficiary-name">
            <span style={{ fontWeight: 600 }}>{farmer.firstName} {farmer.lastName}</span>
            {farmer.status && <Pill status={farmer.status} />}
          </div>
          <div className="agri-beneficiary-meta">RSBSA {farmer.rsbsaNo}</div>
          <div className="agri-beneficiary-meta">{[farmer.sitioPurok, farmer.barangay].filter(Boolean).join(", ")} · Farm size {formatHectares(farmer.farmSize)}</div>
        </div>
        {!locked && (
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => onPick(null)} disabled={disabled}>Change</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        className={`form-control${invalid ? " is-invalid" : ""}`}
        placeholder="Type a name or RSBSA number"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        autoFocus
      />
      {query.trim() && (
        <div className="agri-tag-suggestions" role="listbox">
          {searching && <div className="agri-tag-suggestion-empty">Searching…</div>}
          {!searching && searchError && <div className="agri-tag-suggestion-empty" style={{ color: "var(--agri-red)" }}>{searchError}</div>}
          {!searching && !searchError && results.length === 0 && <div className="agri-tag-suggestion-empty">No matching farmers.</div>}
          {!searching &&
            results.map((f) => (
              <button
                type="button"
                key={f.id}
                role="option"
                aria-selected="false"
                className="agri-tag-suggestion"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  onPick(f);
                }}
              >
                <FarmerAvatar url={f.avatarUrl} firstName={f.firstName} lastName={f.lastName} size={28} />
                <span className="agri-tag-suggestion-info">
                  <span className="agri-tag-suggestion-name">{f.firstName} {f.lastName}</span>
                  <span className="agri-tag-suggestion-meta">RSBSA {f.rsbsaNo} · {f.barangay} · {formatHectares(f.farmSize)}</span>
                </span>
                <span className="agri-tag-suggestion-badges"><Pill status={f.status} /></span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
