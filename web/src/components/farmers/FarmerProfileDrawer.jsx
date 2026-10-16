import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import Pill from "../ui/Pill.jsx";
import { useEscapeToClose } from "../../hooks/useEscapeToClose.js";
import { getFarmerProfile } from "../../lib/api/farmers.js";
import { listFarmerDistributionHistory } from "../../lib/api/distributions.js";
import { getLatestSubmissionForFarmer } from "../../lib/api/cropValidation.js";
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

// farmers.validation_status has no "rejected" — that only exists on a crop
// validation submission, so a not-validated farmer whose latest submission
// was rejected shows "Rejected".
function validationBadge(status, latest) {
  if (status === "Validated" || status === "Pending") return status;
  return latest?.status === "Rejected" ? "Rejected" : "Not Validated";
}

function totalsByUnit(rows) {
  const totals = {};
  for (const r of rows) totals[r.unit] = (totals[r.unit] ?? 0) + r.quantity;
  return Object.entries(totals).map(([unit, qty]) => `${qty.toLocaleString()} ${unit}`).join(" · ");
}

// Read-only Farmer Profile, opened from the Farmers table (row click or the
// row menu's "View"). Right-side drawer; closes on ✕, Escape, or a click on
// the backdrop. `farmer` is the list row, used for the header while the full
// profile loads and as the record handed to the existing Edit form.
export default function FarmerProfileDrawer({ farmer, canEdit, showAccount, onEdit, onClose }) {
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
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
    Promise.all([getFarmerProfile(farmer.id), listFarmerDistributionHistory(farmer.id), getLatestSubmissionForFarmer(farmer.id)])
      .then(([p, h, v]) => {
        if (cancelled) return;
        setProfile(p);
        setHistory(h);
        setLatest(v);
      })
      .catch((err) => !cancelled && setError(friendlyError(err, "Couldn't load this farmer's profile. Please try again.")));
    return () => {
      cancelled = true;
    };
  }, [farmer.id]);

  const p = profile;
  const fullName = [farmer.firstName, farmer.middleName, farmer.lastName, p?.extensionName].filter(Boolean).join(" ");
  const initials = `${farmer.firstName?.[0] ?? ""}${farmer.lastName?.[0] ?? ""}`.toUpperCase();
  const age = ageOn(p?.birthDate);
  const address = p
    ? [p.address.houseNo, p.address.street, p.address.barangay, p.address.municipality, p.address.province, p.address.zipcode].filter(Boolean).join(", ")
    : "";
  const crops = p ? [...new Set(p.parcels.flatMap((parcel) => parcel.crops.map((c) => c.cropType)))].join(", ") : "";

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
            {p?.avatarUrl ? (
              <img className="agri-profile-avatar" src={p.avatarUrl} alt="" />
            ) : (
              <div className="agri-profile-avatar" aria-hidden="true">{initials}</div>
            )}
            <div style={{ minWidth: 0 }}>
              <h2 id="farmer-profile-name" className="agri-profile-name">{fullName}</h2>
              <div className="agri-muted agri-profile-rsbsa">RSBSA No. {farmer.rsbsaNo}</div>
              <div className="agri-profile-badges">
                <Pill status={p?.status ?? farmer.status} />
                {p && <Pill status={validationBadge(p.validationStatus, latest)} />}
              </div>
            </div>
          </div>
        </header>

        <div className="agri-drawer-body">
          {error && <div className="agri-pill red" style={{ display: "block", padding: "8px 12px", marginTop: 16 }}>{error}</div>}
          {!p && !error && <div className="agri-muted" style={{ padding: "24px 0" }}>Loading profile…</div>}

          {p && (
            <>
              <ProfileSection title="Personal Information">
                <Info label="Sex" value={p.sex} />
                <Info label="Birth date" value={p.birthDate ? `${formatDate(p.birthDate)}${age != null ? ` (${age} yrs)` : ""}` : null} />
                <Info label="Birth place" value={p.birthPlace} />
                <Info label="Civil status" value={p.civilStatus} />
                <Info label="Contact number" value={p.contactNo} />
                <Info label="Religion" value={p.religion} />
                <Info label="Address" value={address} wide />
                <Info label="Household head" value={p.householdHead} />
                <Info label="Household members" value={p.householdMembers} />
                <Info label="Female members" value={p.femaleMembers} />
                <Info label="4Ps beneficiary" value={p.is4psBeneficiary} />
                <Info label="Indigenous group" value={p.indigenousGroup} />
                <Info label="Organization affiliation" value={p.orgAffiliation} />
                <Info label="Date registered" value={formatDate(p.dateRegistered)} />
              </ProfileSection>

              <ProfileSection title="Farm Information">
                {p.parcels.length <= 1 ? (
                  <ParcelInfo parcel={p.parcels[0]} crops={crops} />
                ) : (
                  <>
                    <Info label="Commodity" value={crops} />
                    <Info label="Farm parcels" value={`${p.parcels.length} parcels`} />
                    {p.parcels.map((parcel) => (
                      <div key={parcel.parcelNo} className="agri-profile-parcel">
                        <div className="agri-profile-parcel-title">Parcel {parcel.parcelNo}</div>
                        <div className="agri-kv-grid">
                          <ParcelInfo parcel={parcel} crops={parcel.crops.map((c) => c.cropType).join(", ")} />
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </ProfileSection>

              {showAccount && (
                <ProfileSection title="Mobile Account">
                  {p.hasMobileAccount ? (
                    <>
                      <Info label="Login ID" value={farmer.rsbsaNo.replace(/\D/g, "").slice(-6)} />
                      <Info
                        label="Password"
                        value={
                          p.usingDefaultPassword == null
                            ? null
                            : p.usingDefaultPassword
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
                {history.length === 0 ? (
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
                <div className="agri-detail-section-title">Validation History</div>
                {latest ? (
                  <div className="agri-kv-grid">
                    <Info label="Latest submission" value={<Pill status={latest.status} />} />
                    <Info label="Submitted" value={formatDate(latest.submittedAt)} />
                    <Info label="Reviewed" value={latest.reviewedAt ? `${formatDate(latest.reviewedAt)}${latest.reviewedBy ? ` by ${latest.reviewedBy}` : ""}` : null} />
                    <Info label="Remarks" value={latest.remarks} wide />
                  </div>
                ) : (
                  <div className="agri-muted agri-profile-note">No crop validation submitted yet.</div>
                )}
              </section>
            </>
          )}
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

function ParcelInfo({ parcel, crops }) {
  return (
    <>
      <Info label="Commodity" value={crops} />
      <Info label="Farm size" value={parcel?.farmSize != null ? `${parcel.farmSize} ha` : null} />
      <Info label="Farm location" value={parcel?.farmLocation} />
      <Info label="Ownership" value={parcel?.ownershipType} />
      <Info label="PCIC insured" value={parcel?.pcicInsured} />
      <Info label="Organic practitioner" value={parcel?.organicPractitioner} />
      <Info label="Agrarian reform beneficiary" value={parcel?.agrarianReformBeneficiary} />
      <Info label="Livestock" value={parcel?.livestockDetails} />
    </>
  );
}
