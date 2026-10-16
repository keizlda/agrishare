import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import Pill from "../ui/Pill.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { getFarmerProfileExtras } from "../../lib/api/farmers.js";
import { listFarmerDistributionHistory } from "../../lib/api/distributions.js";
import { listSubmissionsForFarmer } from "../../lib/api/cropValidation.js";
import { friendlyError } from "../../lib/friendlyError.js";

const DASH = "—";
const show = (v) => (v === null || v === undefined || v === "" ? DASH : v);

function formatDate(value) {
  if (!value) return DASH;
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ageOn(birthDate, today = new Date()) {
  if (!birthDate) return null;
  const b = new Date(`${birthDate}T00:00:00`);
  let age = today.getFullYear() - b.getFullYear();
  if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--;
  return age;
}

function totalsByUnit(rows) {
  const totals = {};
  for (const r of rows) totals[r.unit] = (totals[r.unit] ?? 0) + r.quantity;
  return Object.entries(totals).map(([unit, qty]) => `${qty.toLocaleString()} ${unit}`).join(" · ");
}

// Read-only Farmer Profile, opened from the Farmers table (row click or the
// row menu's "View"). Right-side drawer; closes on ✕, Escape, or a click on
// the backdrop. The fields are exactly the Add/Edit Farmer form's, in the
// form's order and with its labels, read from `farmer` — the same list row
// the form is filled from — so the panel mirrors what the admin entered.
export default function FarmerProfileDrawer({ farmer, canEdit, showAccount, onEdit, onClose }) {
  const [extras, setExtras] = useState(null);
  const [history, setHistory] = useState(null);
  const [submissions, setSubmissions] = useState(null);
  const [error, setError] = useState("");
  const closeRef = useRef(null);

  useEscapeToClose(true, onClose);

  // Focus the drawer on open and hand focus back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getFarmerProfileExtras(farmer.id), listFarmerDistributionHistory(farmer.id), listSubmissionsForFarmer(farmer.id)])
      .then(([x, h, subs]) => {
        if (cancelled) return;
        setExtras(x);
        setHistory(h);
        setSubmissions(subs);
      })
      .catch((err) => !cancelled && setError(friendlyError(err, "Couldn't load this farmer's profile. Please try again.")));
    return () => {
      cancelled = true;
    };
  }, [farmer.id]);

  const f = farmer;
  const loaded = !!history;
  const fullName = [f.firstName, f.middleName, f.lastName, extras?.extensionName].filter(Boolean).join(" ");
  const initials = `${f.firstName?.[0] ?? ""}${f.lastName?.[0] ?? ""}`.toUpperCase();
  const age = ageOn(f.birthDate);

  return (
    <div className="agri-drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="agri-drawer" role="dialog" aria-modal="true" aria-labelledby="farmer-profile-name">
        <header className="agri-drawer-header">
          <div className="agri-drawer-topline">
            <span className="agri-drawer-eyebrow">Farmer Profile</span>
            <button ref={closeRef} type="button" className="agri-icon-btn" aria-label="Close farmer profile" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="agri-profile-head">
            {extras?.avatarUrl ? (
              <img className="agri-profile-avatar" src={extras.avatarUrl} alt="" />
            ) : (
              <div className="agri-profile-avatar" aria-hidden="true">{initials}</div>
            )}
            <div style={{ minWidth: 0 }}>
              <h2 id="farmer-profile-name" className="agri-profile-name">{fullName}</h2>
              <div className="agri-muted agri-profile-rsbsa">RSBSA No. {f.rsbsaNo}</div>
              {/* A farmer's own status is only Active/Inactive; validation
                  belongs to each proof-of-planting submission (below). */}
              <div className="agri-profile-badges">
                <Pill status={f.status} />
              </div>
            </div>
          </div>
        </header>

        <div className="agri-drawer-body">
          {error && <div className="agri-pill red" style={{ display: "block", padding: "8px 12px", marginTop: 16 }}>{error}</div>}

          {/* Add/Edit form: Identification + Address */}
          <ProfileSection title="Personal Information">
            <Info label="First Name" value={f.firstName} />
            <Info label="Middle Name" value={f.middleName} />
            <Info label="Last Name" value={f.lastName} />
            <Info label="Sex" value={f.sex} />
            <Info label="Birth Date" value={f.birthDate ? `${formatDate(f.birthDate)}${age != null ? ` (${age} yrs)` : ""}` : null} />
            <Info label="Contact No." value={f.contactNo} />
            <Info label="Sitio / Purok" value={f.sitioPurok} />
            <Info label="Barangay" value={f.barangay} />
            <Info label="Municipality" value={f.municipality} />
            <Info label="Province" value={f.province} />
          </ProfileSection>

          {/* Add/Edit form: Farm Information */}
          <ProfileSection title="Farm Information">
            <Info label="Commodity / Crop Type" value={f.commodity} />
            {/* An empty Farm Size is saved as 0. */}
            <Info label="Farm Size (ha)" value={f.farmSize ? f.farmSize : null} />
            <Info label="Farm Location" value={f.farmLocation} wide />
            <Info label="Ownership / Tenurial Status" value={f.ownershipType} />
            <Info label="PCIC Insured" value={f.pcicInsured} />
          </ProfileSection>

          {/* Add/Edit form: Affiliation & Status */}
          <ProfileSection title="Affiliation & Status">
            <Info label="Organization Affiliation" value={f.orgAffiliation} />
            <Info label="Status" value={f.status} />
          </ProfileSection>

          {showAccount && (
            <ProfileSection title="Mobile Account">
              {!extras ? (
                <div className="agri-muted agri-profile-note">{error ? DASH : "Loading…"}</div>
              ) : extras.hasMobileAccount ? (
                <>
                  <Info label="Login ID" value={f.rsbsaNo.replace(/\D/g, "").slice(-6)} />
                  <Info
                    label="Password"
                    value={
                      extras.usingDefaultPassword == null
                        ? null
                        : extras.usingDefaultPassword
                          ? "Still using the default password"
                          : "Changed by the farmer"
                    }
                  />
                </>
              ) : (
                <div className="agri-muted agri-profile-note">No mobile account linked to this farmer yet.</div>
              )}
            </ProfileSection>
          )}

          <section className="agri-profile-section">
            <div className="agri-detail-section-title">Distribution History</div>
            {!loaded ? (
              <div className="agri-muted agri-profile-note">{error ? DASH : "Loading…"}</div>
            ) : history.length === 0 ? (
              <div className="agri-muted agri-profile-note">Not tagged in any distribution yet.</div>
            ) : (
              <>
                <div className="agri-profile-table-wrap">
                  <table className="agri-table agri-profile-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Program</th>
                        <th>Commodity</th>
                        <th className="text-end">Qty received</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.claimId}>
                          <td>{formatDate(h.date)}</td>
                          <td className="agri-profile-wrap">{show(h.program)}</td>
                          <td className="agri-profile-wrap">{show(h.commodity)}</td>
                          <td className="text-end">{h.quantity.toLocaleString()} {h.unit}</td>
                          <td><Pill status={h.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="agri-profile-total">
                  Total received: <strong>{totalsByUnit(history)}</strong> across {history.length}{" "}
                  {history.length === 1 ? "distribution" : "distributions"}
                </div>
              </>
            )}
          </section>

          <section className="agri-profile-section">
            <div className="agri-detail-section-title">Proof of Planting Submissions</div>
            {!submissions ? (
              <div className="agri-muted agri-profile-note">{error ? DASH : "Loading…"}</div>
            ) : submissions.length === 0 ? (
              <div className="agri-muted agri-profile-note">No proof of planting submitted yet.</div>
            ) : (
              <div className="agri-profile-table-wrap">
                <table className="agri-table agri-profile-table">
                  <thead>
                    <tr>
                      <th>Date submitted</th>
                      <th>Crop</th>
                      <th>Status</th>
                      <th>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.id}>
                        <td>{formatDate(s.submittedAt)}</td>
                        <td className="agri-profile-wrap">{show(s.crop || f.commodity)}</td>
                        <td><Pill status={s.status} /></td>
                        <td className="agri-profile-wrap">{show(s.remarks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <footer className="agri-drawer-footer">
          {canEdit && (
            <button type="button" className="btn btn-agri-primary d-flex align-items-center gap-2" onClick={onEdit}>
              <Pencil size={15} /> Edit
            </button>
          )}
          <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Close</button>
        </footer>
      </aside>
    </div>
  );
}

function ProfileSection({ title, children }) {
  return (
    <section className="agri-profile-section">
      <div className="agri-detail-section-title">{title}</div>
      <div className="agri-kv-grid">{children}</div>
    </section>
  );
}

function Info({ label, value, wide }) {
  return (
    <div style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <div className="agri-kv-label">{label}</div>
      <div className="agri-kv-value">{show(value)}</div>
    </div>
  );
}
