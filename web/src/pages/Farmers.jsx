import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Filter, Pencil, Plus, Power, Search, Trash2, X } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import Pill from "../components/ui/Pill.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import { Users, ShieldCheck, ShieldX } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { commodityCategories, computeFarmerStats } from "../data/mockData.js";
import { createFarmer, deleteFarmer, listFarmers, setFarmerStatus, updateFarmer } from "../lib/api/farmers.js";

const PAGE_SIZE = 5;

// Farmers page only offers actual crop commodities in its dropdowns — Farm
// Tools/Livestock are program categories (still valid on the Commodities
// page), not something a farmer record is planted with.
const FARMER_COMMODITY_OPTIONS = commodityCategories.filter((c) => c !== "Farm Tools" && c !== "Livestock");
const OWNERSHIP_OPTIONS = ["Owner", "Tenant", "Lessee", "Farmworker"];
const PCIC_OPTIONS = ["Yes", "No", "Not Applicable"];

const EMPTY_FORM = {
  rsbsaNo: "",
  firstName: "",
  middleName: "",
  lastName: "",
  sex: "Male",
  birthDate: "",
  contactNo: "",
  sitioPurok: "",
  barangay: "Langapud",
  municipality: "Labangan",
  province: "Zamboanga del Sur",
  householdHead: "No",
  householdMembers: "",
  commodity: "Rice",
  farmSize: "",
  farmLocation: "",
  ownershipType: "Owner",
  pcicInsured: "Not Applicable",
  livestockDetails: "",
  orgAffiliation: "",
  status: "Active",
};

function farmerToForm(f) {
  return {
    rsbsaNo: f.rsbsaNo ?? "",
    firstName: f.firstName ?? "",
    middleName: f.middleName ?? "",
    lastName: f.lastName ?? "",
    sex: f.sex ?? "Male",
    birthDate: f.birthDate ?? "",
    contactNo: f.contactNo ?? "",
    sitioPurok: f.sitioPurok ?? "",
    barangay: f.barangay ?? "Langapud",
    municipality: f.municipality ?? "Labangan",
    province: f.province ?? "Zamboanga del Sur",
    householdHead: f.householdHead ?? "No",
    householdMembers: f.householdMembers ?? "",
    commodity: f.commodity || "Rice",
    farmSize: f.farmSize ?? "",
    farmLocation: f.farmLocation ?? "",
    ownershipType: f.ownershipType || "Owner",
    pcicInsured: f.pcicInsured || "Not Applicable",
    livestockDetails: f.livestockDetails ?? "",
    orgAffiliation: f.orgAffiliation ?? "",
    status: f.status || "Active",
  };
}

function normalizeName(form) {
  return `${form.firstName} ${form.middleName} ${form.lastName}`.trim().toLowerCase().replace(/\s+/g, " ");
}

function findDuplicateFarmer(farmers, form, excludeId) {
  const rsbsa = form.rsbsaNo.trim().toLowerCase();
  const name = normalizeName(form);
  return farmers.find((f) => {
    if (excludeId != null && f.id === excludeId) return false;
    const rsbsaMatch = f.rsbsaNo.trim().toLowerCase() === rsbsa;
    const nameMatch = normalizeName(f) === name && f.birthDate === form.birthDate;
    return rsbsaMatch || nameMatch;
  });
}

function validateFarmerForm(form) {
  const errors = {};
  if (!form.rsbsaNo.trim()) errors.rsbsaNo = "RSBSA number is required.";
  if (!form.firstName.trim()) errors.firstName = "First name is required.";
  if (!form.lastName.trim()) errors.lastName = "Last name is required.";
  if (!form.sex) errors.sex = "Sex is required.";
  if (!form.birthDate) errors.birthDate = "Birth date is required.";

  const cleanedContact = form.contactNo.replace(/\s+/g, "");
  if (!cleanedContact) {
    errors.contactNo = "Contact number is required.";
  } else if (!/^09\d{9}$/.test(cleanedContact)) {
    errors.contactNo = "Enter an 11-digit number starting with 09 (e.g. 09XX XXX XXXX).";
  }

  if (form.householdMembers !== "" && Number(form.householdMembers) < 1) {
    errors.householdMembers = "Must be at least 1.";
  }

  if (!(Number(form.farmSize) > 0)) {
    errors.farmSize = "Farm size must be a positive number.";
  }

  return errors;
}

export default function Farmers() {
  const { user } = useAuth();
  const location = useLocation();
  const isMAO = user?.role !== "FA President";
  const { data: farmers, setData: setFarmers, loading, error: loadError } = useSupabaseList(listFarmers);
  const [search, setSearch] = useState(location.state?.presetSearch ?? "");
  const [commodityFilter, setCommodityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Deep-link support: the Validation page's "View full profile" / "Open
  // farmer record" links navigate here with a preset search term.
  useEffect(() => {
    if (location.state?.presetSearch) setSearch(location.state.presetSearch);
  }, [location.state]);
  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", farmer }
  const [pendingDelete, setPendingDelete] = useState(null);
  const [actionError, setActionError] = useState("");

  const stats = computeFarmerStats(farmers);

  const filtered = useMemo(() => {
    return farmers.filter((f) => {
      const fullName = `${f.firstName} ${f.lastName}`.toLowerCase();
      const matchesSearch = !search || fullName.includes(search.toLowerCase()) || f.rsbsaNo.includes(search);
      const matchesCommodity = commodityFilter === "All" || f.commodity === commodityFilter;
      const matchesStatus = statusFilter === "All" || f.status === statusFilter;
      return matchesSearch && matchesCommodity && matchesStatus;
    });
  }, [farmers, search, commodityFilter, statusFilter]);

  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE);

  async function handleDelete(id) {
    setActionError("");
    try {
      await deleteFarmer(id);
      setFarmers((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPendingDelete(null);
    }
  }

  async function handleToggleStatus(id) {
    setActionError("");
    const current = farmers.find((f) => f.id === id);
    if (!current) return;
    const nextStatus = current.status === "Active" ? "Inactive" : "Active";
    try {
      await setFarmerStatus(id, nextStatus);
      setFarmers((prev) => prev.map((f) => (f.id === id ? { ...f, status: nextStatus } : f)));
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={Users} label="Total Farmers" value={stats.total} sub="All registered farmers" color="green" />
        <StatCard icon={ShieldCheck} label="Validated" value={stats.validated} sub={`${Math.round((stats.validated / (stats.total || 1)) * 100)}% of total`} color="blue" />
        <StatCard icon={ShieldX} label="Not Validated" value={stats.total - stats.validated} sub={`${Math.round(((stats.total - stats.validated) / (stats.total || 1)) * 100)}% of total`} color="orange" />
      </OverviewDrawer>

      <div className="agri-card" style={{ padding: 16 }}>
        {(loadError || actionError) && (
          <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
            {loadError || actionError}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
          <div style={{ position: "relative", flex: "1 1 220px" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "#8b978f" }} />
            <input
              className="form-control"
              placeholder="Search farmer by name or RSBSA no."
              style={{ paddingLeft: 32 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="form-select" style={{ width: 170 }} value={commodityFilter} onChange={(e) => setCommodityFilter(e.target.value)}>
            <option value="All">All Commodities</option>
            {FARMER_COMMODITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>

          <select className="form-select" style={{ width: 150 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <button className="agri-icon-btn"><Filter size={16} /></button>

          {isMAO && (
            <button className="btn btn-agri-primary ms-auto d-flex align-items-center gap-2" onClick={() => setModal({ mode: "add" })}>
              <Plus size={16} /> Add Farmer
            </button>
          )}
        </div>

        <div className="agri-table-wrap">
          <table className="agri-table">
            <thead>
              <tr>
                <th>RSBSA No.</th><th>Full Name</th><th>Sex</th><th>Birth Date</th><th>Contact No.</th>
                <th>Barangay</th><th>Commodity</th><th>Farm Size</th><th>Farm Location</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((f) => (
                <tr key={f.id}>
                  <td>{f.rsbsaNo}</td>
                  <td>{f.firstName} {f.lastName}</td>
                  <td>{f.sex}</td>
                  <td>{f.birthDate}</td>
                  <td>{f.contactNo}</td>
                  <td>{f.barangay}</td>
                  <td>{f.commodity}</td>
                  <td>{f.farmSize} ha</td>
                  <td>{f.farmLocation}</td>
                  <td><Pill status={f.status} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {isMAO ? (
                        <>
                          <button className="agri-icon-btn" title="Edit" onClick={() => setModal({ mode: "edit", farmer: f })}>
                            <Pencil size={14} />
                          </button>
                          <button className="agri-icon-btn" title="Delete" onClick={() => setPendingDelete(f)}>
                            <Trash2 size={14} color="var(--agri-red)" />
                          </button>
                        </>
                      ) : (
                        <button
                          className="agri-icon-btn"
                          title={f.status === "Active" ? "Mark Inactive" : "Mark Active"}
                          onClick={() => handleToggleStatus(f.id)}
                        >
                          <Power size={14} color={f.status === "Active" ? "var(--agri-red)" : "var(--agri-primary)"} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={11} className="agri-muted text-center py-4">Loading farmers…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={11} className="agri-muted text-center py-4">No farmer records match your search/filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="agri-muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
          Showing {pageItems.length} of {filtered.length} farmers
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {modal && (
        <FarmerModal
          mode={modal.mode}
          farmer={modal.farmer}
          farmers={farmers}
          onClose={() => setModal(null)}
          onViewExisting={(rsbsaNo) => {
            setSearch(rsbsaNo);
            setModal(null);
          }}
          onSaved={(saved) => {
            if (modal.mode === "edit") {
              setFarmers((prev) => prev.map((f) => (f.id === saved.id ? saved : f)));
            } else {
              setFarmers((prev) => [saved, ...prev]);
            }
            setModal(null);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete Farmer Record?"
          message={`This will permanently remove ${pendingDelete.firstName} ${pendingDelete.lastName} (${pendingDelete.rsbsaNo}) from the system. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function FarmerModal({ mode, farmer, farmers, onClose, onSaved, onViewExisting }) {
  const [form, setForm] = useState(() => (mode === "edit" ? farmerToForm(farmer) : EMPTY_FORM));
  const [errors, setErrors] = useState({});
  const [duplicate, setDuplicate] = useState(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setDuplicate(null);

    const fieldErrors = validateFarmerForm(form);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    const excludeId = mode === "edit" ? farmer.id : null;
    const match = findDuplicateFarmer(farmers, form, excludeId);
    if (match) {
      setDuplicate(match);
      return;
    }

    const cleanForm = { ...form, contactNo: form.contactNo.replace(/\s+/g, "") };

    setSaving(true);
    try {
      const saved = mode === "edit" ? await updateFarmer(farmer.id, cleanForm) : await createFarmer(cleanForm);
      onSaved(saved);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        className="agri-card"
        style={{ width: 640, maxWidth: "94vw", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-panel-header" style={{ margin: 0, padding: "18px 22px", borderBottom: "1px solid var(--agri-border)" }}>
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{mode === "edit" ? "Edit Farmer" : "Add Farmer"}</div>
          <button className="agri-icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ padding: "18px 22px", overflowY: "auto", flex: 1 }}>
          {duplicate && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "10px 12px" }}>
              A farmer with matching RSBSA number / name and birthdate already exists.
              <button
                type="button"
                className="btn btn-link p-0"
                style={{ display: "block", fontSize: "0.8rem", marginTop: 4 }}
                onClick={() => onViewExisting(duplicate.rsbsaNo)}
              >
                View existing record: {duplicate.firstName} {duplicate.lastName} — RSBSA {duplicate.rsbsaNo}
              </button>
            </div>
          )}
          {formError && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
              {formError}
            </div>
          )}

          <form id="farmer-form" onSubmit={handleSubmit}>
            <Section title="Identification">
              <Field label="RSBSA Number" col={12} required error={errors.rsbsaNo}>
                <input className="form-control" placeholder="2024-01-002-000XXX" value={form.rsbsaNo} onChange={(e) => update("rsbsaNo", e.target.value)} />
              </Field>
              <Field label="First Name" col={4} required error={errors.firstName}>
                <input className="form-control" value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
              </Field>
              <Field label="Middle Name" col={4}>
                <input className="form-control" value={form.middleName} onChange={(e) => update("middleName", e.target.value)} />
              </Field>
              <Field label="Last Name" col={4} required error={errors.lastName}>
                <input className="form-control" value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
              </Field>
              <Field label="Sex" col={4} required error={errors.sex}>
                <select className="form-select" value={form.sex} onChange={(e) => update("sex", e.target.value)}>
                  <option>Male</option><option>Female</option>
                </select>
              </Field>
              <Field label="Birth Date" col={4} required error={errors.birthDate}>
                <input type="date" className="form-control" value={form.birthDate} onChange={(e) => update("birthDate", e.target.value)} />
              </Field>
              <Field label="Contact No." col={4} required error={errors.contactNo}>
                <input className="form-control" value={form.contactNo} onChange={(e) => update("contactNo", e.target.value)} placeholder="09XX XXX XXXX" />
              </Field>
            </Section>

            <Section title="Address">
              <Field label="Sitio / Purok" col={6}>
                <input className="form-control" value={form.sitioPurok} onChange={(e) => update("sitioPurok", e.target.value)} />
              </Field>
              <Field label="Barangay" col={6}>
                <input className="form-control" value={form.barangay} readOnly />
              </Field>
              <Field label="Municipality" col={6}>
                <input className="form-control" value={form.municipality} readOnly />
              </Field>
              <Field label="Province" col={6}>
                <input className="form-control" value={form.province} readOnly />
              </Field>
            </Section>

            <Section title="Household">
              <Field label="Household Head" col={6}>
                <select className="form-select" value={form.householdHead} onChange={(e) => update("householdHead", e.target.value)}>
                  <option>No</option><option>Yes</option>
                </select>
              </Field>
              <Field label="No. of Household Members" col={6} error={errors.householdMembers}>
                <input type="number" min="1" className="form-control" value={form.householdMembers} onChange={(e) => update("householdMembers", e.target.value)} />
              </Field>
            </Section>

            <Section title="Farm Information">
              <Field label="Commodity / Crop Type" col={6}>
                <select className="form-select" value={form.commodity} onChange={(e) => update("commodity", e.target.value)}>
                  {FARMER_COMMODITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Farm Size (ha)" col={6} error={errors.farmSize}>
                <input type="number" step="0.01" min="0" className="form-control" value={form.farmSize} onChange={(e) => update("farmSize", e.target.value)} />
              </Field>
              <Field label="Farm Location" col={12}>
                <input className="form-control" placeholder="Sitio or parcel description" value={form.farmLocation} onChange={(e) => update("farmLocation", e.target.value)} />
              </Field>
              <Field label="Ownership / Tenurial Status" col={6}>
                <select className="form-select" value={form.ownershipType} onChange={(e) => update("ownershipType", e.target.value)}>
                  {OWNERSHIP_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="PCIC Insured" col={6}>
                <select className="form-select" value={form.pcicInsured} onChange={(e) => update("pcicInsured", e.target.value)}>
                  {PCIC_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="Livestock Details" col={12}>
                <textarea className="form-control" rows={2} placeholder="e.g. 2 carabao, 5 goats" value={form.livestockDetails} onChange={(e) => update("livestockDetails", e.target.value)} />
              </Field>
            </Section>

            <Section title="Affiliation & Status" last>
              <Field label="Organization Affiliation" col={6}>
                <input className="form-control" placeholder="Farmers' association name" value={form.orgAffiliation} onChange={(e) => update("orgAffiliation", e.target.value)} />
              </Field>
              <Field label="Status" col={6}>
                <select className="form-select" value={form.status} onChange={(e) => update("status", e.target.value)}>
                  <option>Active</option><option>Inactive</option>
                </select>
              </Field>
            </Section>
          </form>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--agri-border)" }}>
          <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="farmer-form" className="btn btn-agri-primary" disabled={saving}>{saving ? "Saving…" : "Save Farmer"}</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, last }) {
  return (
    <div style={{ marginBottom: last ? 0 : 20 }}>
      <div
        style={{
          fontWeight: 700, fontSize: "0.8rem", color: "var(--agri-primary-dark)", textTransform: "uppercase",
          letterSpacing: "0.03em", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--agri-border)",
        }}
      >
        {title}
      </div>
      <div className="row g-3">{children}</div>
    </div>
  );
}

function Field({ label, col, required, error, children }) {
  return (
    <div className={`col-${col}`}>
      <label className="agri-form-label">
        {label}
        {required && <span style={{ color: "var(--agri-red)" }}> *</span>}
      </label>
      {children}
      {error && <div style={{ color: "var(--agri-red)", fontSize: "0.72rem", marginTop: 4 }}>{error}</div>}
    </div>
  );
}
