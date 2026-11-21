import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Send, X } from "lucide-react";
import Pill from "../ui/Pill.jsx";
import FarmerAvatar from "../ui/FarmerAvatar.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { searchFarmers } from "../../lib/api/farmers.js";
import { listCommodities } from "../../lib/api/commodities.js";
import { fileRequestForFarmer, findOpenRequests } from "../../lib/api/requests.js";
import { computeAllocation, formatHectares, hasAllocation } from "../../lib/allocation.js";
import { formatDate } from "../../lib/dates.js";
import { formatQuantity } from "../../lib/quantity.js";
import { friendlyError } from "../../lib/friendlyError.js";

// Same limits as the farmer's own request form (mobile).
const MAX_QUANTITY = 10000;
const MAX_REASON = 300;

function problemWith({ farmer, commodity, quantity, reason }) {
  if (!farmer) return "Search for the farmer this request is for.";
  if (!commodity) return "Choose the commodity.";
  if (!quantity.trim() || !reason.trim()) return "Enter a quantity and the reason for the request.";
  if (!/^\d+(\.\d{1,2})?$/.test(quantity.trim())) return "Enter the quantity as a number, for example 25.";
  const qty = Number(quantity);
  if (qty <= 0) return "Enter a quantity greater than 0.";
  if (qty > MAX_QUANTITY) return `That quantity looks too large. Enter up to ${MAX_QUANTITY.toLocaleString()}.`;
  if (reason.trim().length > MAX_REASON) return `Keep the reason to ${MAX_REASON} characters or fewer.`;
  return "";
}

// "Add Farmer Request" (Farmers' Association President): file a commodity
// request for a farmer — e.g. one without a phone. It goes straight to the
// MAO as Endorsed, tagged "Filed by Farmers' Association President", and the
// farmer is notified.
export default function FarmerRequestModal({ onClose, onSaved }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [farmer, setFarmer] = useState(null);
  const [commodities, setCommodities] = useState([]);
  const [commodityId, setCommodityId] = useState("");
  const [quantity, setQuantity] = useState("");
  // The quantity follows the suggestion until it's typed over.
  const [quantityEdited, setQuantityEdited] = useState(false);
  const [reason, setReason] = useState("");
  const [openRequests, setOpenRequests] = useState([]);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEscapeToClose(!saving, onClose);

  useEffect(() => {
    listCommodities()
      .then((rows) => setCommodities(rows.filter((c) => c.status === "Active")))
      .catch((err) => setFormError(friendlyError(err, "Couldn't load the commodities. Close this form and try again.")));
  }, []);

  // Farmer search (name or RSBSA number), as in the Distribution form.
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

  const commodity = commodities.find((c) => String(c.id) === String(commodityId)) ?? null;
  const suggested = farmer && hasAllocation(commodity) && farmer.farmSize > 0 ? computeAllocation(commodity, farmer.farmSize) : null;

  // Prefill the suggested allocation (farm size × rate) unless typed over.
  useEffect(() => {
    if (!quantityEdited) setQuantity(suggested !== null ? String(suggested) : "");
  }, [suggested, quantityEdited]);

  // Open requests for the same farmer and commodity: a warning, not a block.
  const chosenCommodityId = commodity?.id ?? null;
  useEffect(() => {
    setOpenRequests([]);
    if (!farmer || chosenCommodityId === null) return undefined;
    let cancelled = false;
    findOpenRequests(farmer.id, chosenCommodityId)
      .then((rows) => {
        if (!cancelled) setOpenRequests(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [farmer, chosenCommodityId]);

  function pickFarmer(f) {
    setFarmer(f);
    setQuery("");
    setResults([]);
    setFormError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (savingRef.current) return;
    const problem = problemWith({ farmer, commodity, quantity, reason });
    setFormError(problem);
    if (problem) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await fileRequestForFarmer({ farmerId: farmer.id, commodityId: commodity.id, quantity: quantity.trim(), reason });
      onSaved(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't file this request. Please try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const unit = commodity?.unit ?? "kg";

  return (
    <div className="agri-modal-backdrop" onClick={saving ? undefined : onClose}>
      <form
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "520px" }}
        role="dialog"
        aria-label="Add Farmer Request"
        onSubmit={handleSubmit}
        noValidate
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">Add Farmer Request</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose} disabled={saving}><X size={16} /></button>
        </div>
        <div className="agri-modal-body">
          {formError && (
            <div className="agri-pill red" role="alert" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>{formError}</div>
          )}
          <div className="agri-muted" style={{ fontSize: "0.78rem", marginBottom: 14 }}>
            File a request for a farmer who can't send one from the app. It's recorded as filed by you and goes straight to the MAO for approval. The farmer is notified.
          </div>

          <label className="agri-form-label" htmlFor="file-farmer">Farmer <span style={{ color: "var(--agri-red)" }}>*</span></label>
          {farmer ? (
            <div className="agri-picked-farmer">
              <FarmerAvatar url={farmer.avatarUrl} firstName={farmer.firstName} lastName={farmer.lastName} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="agri-beneficiary-name">
                  <span style={{ fontWeight: 600 }}>{farmer.firstName} {farmer.lastName}</span>
                  <Pill status={farmer.status} />
                </div>
                <div className="agri-beneficiary-meta">RSBSA {farmer.rsbsaNo}</div>
                <div className="agri-beneficiary-meta">{[farmer.sitioPurok, farmer.barangay].filter(Boolean).join(", ")}</div>
                <div className="agri-beneficiary-meta">{farmer.cropType || "—"} · {formatHectares(farmer.farmSize)}</div>
              </div>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setFarmer(null)} disabled={saving}>Change</button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                id="file-farmer"
                className="form-control"
                placeholder="Type a name or RSBSA number"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={saving}
                autoFocus
              />
              {query.trim() && (
                <div className="agri-tag-suggestions" role="listbox">
                  {searching && <div className="agri-tag-suggestion-empty">Searching…</div>}
                  {!searching && searchError && <div className="agri-tag-suggestion-empty" style={{ color: "var(--agri-red)" }}>{searchError}</div>}
                  {!searching && !searchError && results.length === 0 && <div className="agri-tag-suggestion-empty">No matching farmers.</div>}
                  {!searching &&
                    results.map((f) => (
                      <button type="button" key={f.id} role="option" aria-selected="false" className="agri-tag-suggestion" onClick={() => pickFarmer(f)}>
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
          )}
          {farmer && farmer.status !== "Active" && (
            <div className="agri-warning-box"><AlertTriangle size={14} /> This farmer is {farmer.status}. Check with the MAO before filing.</div>
          )}

          <label className="agri-form-label" htmlFor="file-commodity" style={{ marginTop: 14 }}>Commodity <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <select id="file-commodity" className="form-select" value={commodityId} onChange={(e) => setCommodityId(e.target.value)} disabled={saving}>
            <option value="">Choose a commodity</option>
            {commodities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {openRequests.length > 0 && (
            <div className="agri-warning-box" role="status">
              <AlertTriangle size={14} style={{ flex: "none", marginTop: 2 }} />
              <div>
                {farmer.firstName} {farmer.lastName} already has {openRequests.length === 1 ? "an open request" : `${openRequests.length} open requests`} for {commodity?.name}:{" "}
                {openRequests.map((r) => `${r.status}, ${formatQuantity(r.quantity, unit)}, ${formatDate(r.date)}`).join("; ")}. You can still file this one.
              </div>
            </div>
          )}

          <label className="agri-form-label" htmlFor="file-quantity" style={{ marginTop: 14 }}>Quantity ({unit}) <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <input
            id="file-quantity"
            inputMode="decimal"
            className="form-control"
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
              setQuantityEdited(true);
            }}
            disabled={saving}
            placeholder="e.g. 25"
          />
          <div className="agri-field-hint">
            {suggested !== null ? (
              <>
                Suggested for {formatHectares(farmer.farmSize)} × {Number(commodity.allocationPerHectare).toLocaleString()} {unit}/ha: {formatQuantity(suggested, unit)}
                {quantityEdited && Number(quantity) !== suggested && (
                  <button type="button" className="agri-link-btn" onClick={() => setQuantityEdited(false)}>Use {formatQuantity(suggested, unit)}</button>
                )}
              </>
            ) : commodity && !hasAllocation(commodity) ? (
              "This commodity has no allocation per hectare, so there's no suggested quantity."
            ) : (
              ""
            )}
          </div>

          <label className="agri-form-label" htmlFor="file-reason" style={{ marginTop: 14 }}>Reason <span style={{ color: "var(--agri-red)" }}>*</span></label>
          <textarea
            id="file-reason"
            className="form-control"
            rows={3}
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            placeholder="e.g. For the wet season planting; the farmer has no phone"
          />
          <div className="agri-muted" style={{ fontSize: "0.72rem", textAlign: "right" }}>{reason.length}/{MAX_REASON}</div>
        </div>

        <div className="agri-modal-footer">
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-agri-primary d-flex align-items-center gap-2" disabled={saving}>
            <Send size={14} /> {saving ? "Filing…" : "File Request"}
          </button>
        </div>
      </form>
    </div>
  );
}
