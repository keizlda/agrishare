import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Copy, KeyRound, Pencil, Plus, Power, Printer, Search, Trash2, Users, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import Pagination from "../components/ui/Pagination.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import RowActionsMenu from "../components/ui/RowActionsMenu.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import Toast from "../components/ui/Toast.jsx";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { commodityCategories } from "../data/mockData.js";
import { friendlyError } from "../lib/friendlyError.js";
import {
  checkLoginIdAvailable,
  createFarmer,
  deleteFarmer,
  findDeletedFarmerByRsbsa,
  isValidRsbsaFormat,
  listFarmers,
  resetFarmerPassword,
  RSBSA_PATTERN,
  setFarmerStatus,
  updateFarmer,
} from "../lib/api/farmers.js";

// Farmers page only offers actual crop commodities in its dropdowns — Farm
// Tools/Livestock are program categories (still valid on the Commodities
// page), not something a farmer record is planted with.
const FARMER_COMMODITY_OPTIONS = commodityCategories.filter((c) => c !== "Farm Tools" && c !== "Livestock");
const OWNERSHIP_OPTIONS = ["Owner", "Tenant", "Lessee", "Farmworker"];
const PCIC_OPTIONS = ["Yes", "No", "Not Applicable"];

// RSBSA number grouping — official Enrollment Form (Revised 01-2024) shape:
// RR-PP-MM-BBB-NNNNNN (region-province-municipality-barangay-sequence), e.g.
// 09-73-12-021-000143. Drives the live-typing formatter below; the matching
// validation pattern (RSBSA_PATTERN) is imported from lib/api/farmers.js so
// the form, the DB-format badge, and the account Edge Function's login-ID
// derivation all agree on one definition.
const RSBSA_GROUPS = [2, 2, 2, 3, 6];
const RSBSA_MAX_DIGITS = RSBSA_GROUPS.reduce((sum, n) => sum + n, 0);

// Strips non-digits, caps at RSBSA_MAX_DIGITS, re-joins into RSBSA_GROUPS —
// a hyphen only appears once the user has actually typed into the next
// group, so there's never a trailing "-".
function formatRsbsaNo(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, RSBSA_MAX_DIGITS);
  const parts = [];
  let i = 0;
  for (const size of RSBSA_GROUPS) {
    if (i >= digits.length) break;
    parts.push(digits.slice(i, i + size));
    i += size;
  }
  return parts.join("-");
}

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
  commodity: "Rice",
  farmSize: "",
  farmLocation: "",
  ownershipType: "Owner",
  pcicInsured: "Not Applicable",
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
    commodity: f.commodity || "Rice",
    farmSize: f.farmSize ?? "",
    farmLocation: f.farmLocation ?? "",
    ownershipType: f.ownershipType || "Owner",
    pcicInsured: f.pcicInsured || "Not Applicable",
    orgAffiliation: f.orgAffiliation ?? "",
    status: f.status || "Active",
  };
}

// Self-contained print window (no route/data round-trip) so the temporary
// password never sits in a URL or gets persisted anywhere retrievable later
// — it only ever exists in memory for the few seconds between the Edge
// Function's response and this slip being printed or dismissed.
function printAccountSlip({ farmerName, rsbsaNo, loginId, password }) {
  const w = window.open("", "_blank", "width=420,height=560");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>AgriShare Login Slip</title><meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; padding: 26px; color: #1f2a24; }
      h1 { font-size: 16px; margin: 0 0 2px; }
      .sub { font-size: 11px; color: #6b7a70; margin-bottom: 20px; }
      .row { margin-bottom: 10px; }
      .label { font-size: 10px; color: #6b7a70; text-transform: uppercase; letter-spacing: .04em; }
      .value { font-size: 15px; font-weight: 700; }
      .box { border: 1px solid #e4eae4; border-radius: 8px; padding: 14px; margin-top: 14px; }
      .note { font-size: 10px; color: #6b7a70; margin-top: 18px; line-height: 1.5; }
    </style></head>
    <body>
      <h1>AgriShare Mobile Login</h1>
      <div class="sub">Municipal Agriculture Office &mdash; Labangan</div>
      <div class="row"><div class="label">Farmer</div><div class="value">${farmerName}</div></div>
      <div class="row"><div class="label">RSBSA No.</div><div class="value">${rsbsaNo}</div></div>
      <div class="box">
        <div class="row"><div class="label">Login ID</div><div class="value">${loginId}</div></div>
        <div class="row" style="margin-bottom:0"><div class="label">Password</div><div class="value">${password}</div></div>
      </div>
      <div class="note">Enter the Login ID and Password on the AgriShare mobile app. Change the password after logging in for the first time.</div>
      <script>window.onload = () => window.print();</script>
    </body></html>`);
  w.document.close();
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
  const trimmedRsbsa = form.rsbsaNo.trim();
  if (!trimmedRsbsa) {
    errors.rsbsaNo = "RSBSA number is required.";
  } else if (!RSBSA_PATTERN.test(trimmedRsbsa)) {
    errors.rsbsaNo = "Enter the complete RSBSA number (format: 09-73-12-021-000143).";
  }
  if (!form.firstName.trim()) errors.firstName = "First name is required.";
  if (!form.lastName.trim()) errors.lastName = "Last name is required.";
  if (!form.sex) errors.sex = "Sex is required.";
  if (!form.birthDate) {
    errors.birthDate = "Birth date is required.";
  } else if (new Date(form.birthDate).getFullYear() >= new Date().getFullYear()) {
    errors.birthDate = "Enter a realistic birth date — not this year or in the future.";
  }

  const cleanedContact = form.contactNo.replace(/\s+/g, "");
  if (!cleanedContact) {
    errors.contactNo = "Contact number is required.";
  } else if (!/^09\d{9}$/.test(cleanedContact)) {
    errors.contactNo = "Enter an 11-digit number starting with 09 (e.g. 09XX XXX XXXX).";
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
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [commodityFilter, setCommodityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Deep-link support: the Validation page's "View full profile" / "Open
  // farmer record" links navigate here with a preset search term.
  useEffect(() => {
    if (location.state?.presetSearch) setSearch(location.state.presetSearch);
  }, [location.state]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [modal, setModal] = useState(null); // null | { mode: "add" } | { mode: "edit", farmer }
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingReset, setPendingReset] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [accountDialog, setAccountDialog] = useState(null); // { farmerName, rsbsaNo, loginId, password, notice? }
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(null);

  const filtered = useMemo(() => {
    const searchDigits = debouncedSearch.replace(/\D/g, "");
    return farmers.filter((f) => {
      const fullName = `${f.firstName} ${f.lastName}`.toLowerCase();
      const matchesSearch =
        !debouncedSearch ||
        fullName.includes(debouncedSearch.toLowerCase()) ||
        f.rsbsaNo.includes(debouncedSearch) ||
        (searchDigits && f.rsbsaNo.replace(/\D/g, "").includes(searchDigits));
      const matchesCommodity = commodityFilter === "All" || f.commodity === commodityFilter;
      const matchesStatus = statusFilter === "All" || f.status === statusFilter;
      return matchesSearch && matchesCommodity && matchesStatus;
    });
  }, [farmers, debouncedSearch, commodityFilter, statusFilter]);


  // Rows per page = however many fit in the full-height table area (min 5).
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: filtered.length > 0 });
  const { page, setPage, totalPages, pageItems } = usePagination(filtered, pageSize);

  async function handleDelete(id) {
    setActionError("");
    try {
      await deleteFarmer(id);
      setFarmers((prev) => prev.filter((f) => f.id !== id));
      setToast({ tone: "success", message: "Farmer removed." });
    } catch (err) {
      setActionError(friendlyError(err, "Couldn't remove this farmer. Please try again."));
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
      setActionError(friendlyError(err, "Couldn't update this farmer's status."));
    }
  }

  async function handleResetPassword() {
    const f = pendingReset;
    setResetting(true);
    setActionError("");
    try {
      const { loginId, password } = await resetFarmerPassword(f.id);
      setPendingReset(null);
      setAccountDialog({ farmerName: `${f.firstName} ${f.lastName}`, rsbsaNo: f.rsbsaNo, loginId, password });
    } catch (err) {
      setActionError(friendlyError(err, "Couldn't reset this farmer's password."));
      setPendingReset(null);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="agri-fill-root">
      <div className="agri-card agri-fill-card" style={{ padding: 16 }}>
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

          {isMAO && (
            <button className="btn btn-agri-primary ms-auto d-flex align-items-center gap-2" onClick={() => setModal({ mode: "add" })}>
              <Plus size={16} /> Add Farmer
            </button>
          )}
        </div>

        <div className="agri-table-wrap" ref={tableRef}>
          <table className="agri-table">
            <thead>
              <tr>
                <th>RSBSA No.</th><th>Full Name</th><th>Sex</th><th>Birth Date</th><th>Contact No.</th>
                <th>Barangay</th><th>Commodity</th><th>Farm Size</th><th>Farm Location</th><th>Status</th><th></th>
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
                    <RowActionsMenu
                      label={`Actions for ${f.firstName} ${f.lastName}`}
                      actions={[
                        isMAO && { key: "edit", label: "Edit", icon: Pencil, onClick: () => setModal({ mode: "edit", farmer: f }) },
                        isMAO &&
                          f.profileId && { key: "reset-password", label: "Reset Password", icon: KeyRound, onClick: () => setPendingReset(f) },
                        isMAO && { key: "delete", label: "Delete", icon: Trash2, danger: true, onClick: () => setPendingDelete(f) },
                        !isMAO && {
                          key: "toggle-status",
                          label: f.status === "Active" ? "Mark Inactive" : "Mark Active",
                          icon: Power,
                          onClick: () => handleToggleStatus(f.id),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={11} className="agri-muted text-center py-4">Loading farmers…</td></tr>
              )}
            </tbody>
          </table>
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={Users}
              title="No farmers found"
              hint={search || commodityFilter !== "All" || statusFilter !== "All" ? "Try a different search or clear the filters." : "Add a farmer to start building the beneficiary list."}
            />
          )}
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
            const { loginId, tempPassword, accountNotice, ...farmer } = saved;
            if (modal.mode === "edit") {
              setFarmers((prev) => prev.map((f) => (f.id === farmer.id ? farmer : f)));
              setToast({ tone: "success", message: "Farmer record updated." });
              if (accountNotice?.type === "account-created") {
                setAccountDialog({
                  farmerName: `${farmer.firstName} ${farmer.lastName}`,
                  rsbsaNo: farmer.rsbsaNo,
                  loginId: accountNotice.loginId,
                  password: accountNotice.password,
                });
              } else if (accountNotice?.type === "login-id-changed") {
                setToast({ tone: "success", message: `Farmer record updated. Their new Login ID is ${accountNotice.loginId}.` });
              } else if (accountNotice?.type === "error") {
                setActionError(`Farmer saved, but the login account couldn't be updated: ${accountNotice.message}`);
              }
            } else {
              setFarmers((prev) => [farmer, ...prev]);
              setToast({ tone: "success", message: "Farmer added." });
              if (loginId) {
                setAccountDialog({ farmerName: `${farmer.firstName} ${farmer.lastName}`, rsbsaNo: farmer.rsbsaNo, loginId, password: tempPassword });
              }
            }
            setModal(null);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete Farmer Record?"
          message={`Delete ${pendingDelete.firstName} ${pendingDelete.lastName}? They'll be removed from the farmer list and their mobile account will be disabled. Their past distribution records will be kept.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingReset && (
        <ConfirmDialog
          title="Reset Password?"
          message={`${pendingReset.firstName} ${pendingReset.lastName}'s password will be set back to the default. They'll be asked to change it the next time they log in.`}
          confirmLabel="Reset Password"
          danger={false}
          busy={resetting}
          onConfirm={handleResetPassword}
          onCancel={() => setPendingReset(null)}
        />
      )}

      {accountDialog && <AccountCredentialsDialog {...accountDialog} onClose={() => setAccountDialog(null)} />}

      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </div>
  );
}

function AccountCredentialsDialog({ farmerName, rsbsaNo, loginId, password, onClose }) {
  const [copied, setCopied] = useState(false);
  useEscapeToClose(true, onClose);

  function handleCopy() {
    navigator.clipboard
      ?.writeText(`Login ID: ${loginId}\nPassword: ${password}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,40,25,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }} onClick={onClose}>
      <div className="agri-card" style={{ width: 380, maxWidth: "90vw", padding: 22, textAlign: "center" }} role="alertdialog" aria-label="Account created" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            width: 46, height: 46, borderRadius: "50%", background: "var(--agri-primary-light)", color: "var(--agri-primary-dark)",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
          }}
        >
          <KeyRound size={22} />
        </div>
        <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>Account created</div>
        <div className="agri-muted" style={{ fontSize: "0.85rem", marginBottom: 16 }}>
          Share these details with {farmerName} so they can log in to the AgriShare mobile app.
        </div>

        <div style={{ border: "1px solid var(--agri-border)", borderRadius: 8, padding: 14, marginBottom: 16, textAlign: "left" }}>
          <div className="agri-muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>Login ID</div>
          <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 10 }}>{loginId}</div>
          <div className="agri-muted" style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>Password</div>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>{password}</div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <button type="button" className="btn btn-outline-secondary flex-fill d-flex align-items-center justify-content-center gap-2" onClick={handleCopy}>
            <Copy size={14} /> {copied ? "Copied!" : "Copy"}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary flex-fill d-flex align-items-center justify-content-center gap-2"
            onClick={() => printAccountSlip({ farmerName, rsbsaNo, loginId, password })}
          >
            <Printer size={14} /> Print Slip
          </button>
        </div>
        <button type="button" className="btn btn-agri-primary w-100" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function FarmerModal({ mode, farmer, farmers, onClose, onSaved, onViewExisting }) {
  const [form, setForm] = useState(() => (mode === "edit" ? farmerToForm(farmer) : EMPTY_FORM));
  const [errors, setErrors] = useState({});
  const [duplicate, setDuplicate] = useState(null);
  const [deletedDuplicate, setDeletedDuplicate] = useState(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEscapeToClose(true, onClose);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    setDuplicate(null);
    setDeletedDuplicate(null);

    const fieldErrors = validateFarmerForm(form);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    const excludeId = mode === "edit" ? farmer.id : null;
    const match = findDuplicateFarmer(farmers, form, excludeId);
    if (match) {
      setDuplicate(match);
      return;
    }

    const rsbsaTrimmed = form.rsbsaNo.trim();
    const rsbsaChanged = rsbsaTrimmed !== (mode === "edit" ? farmer.rsbsaNo : null);

    if (rsbsaChanged) {
      try {
        const deleted = await findDeletedFarmerByRsbsa(rsbsaTrimmed);
        if (deleted) {
          setDeletedDuplicate(deleted);
          return;
        }
      } catch {
        // Non-fatal — proceed and let the DB's own unique index (active
        // farmers only) be the final word if this check couldn't run.
      }
    }

    // Block the save up front if this RSBSA's last-6-digit login ID is
    // already taken by a different farmer — cheaper and clearer than
    // writing the record first and finding out from the Edge Function.
    if (isValidRsbsaFormat(rsbsaTrimmed) && rsbsaChanged) {
      try {
        const check = await checkLoginIdAvailable(rsbsaTrimmed, excludeId);
        if (!check.available) {
          setFormError(`Login ID ${check.loginId} is already used by ${check.conflictWith}. Check the RSBSA number.`);
          return;
        }
      } catch {
        // Non-fatal — the save itself still enforces this via the Edge
        // Function, this pre-check is purely to fail fast in the UI.
      }
    }

    const cleanForm = { ...form, contactNo: form.contactNo.replace(/\s+/g, "") };

    setSaving(true);
    try {
      const saved = mode === "edit" ? await updateFarmer(farmer.id, cleanForm) : await createFarmer(cleanForm);
      onSaved(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this farmer. Please try again."));
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
          {deletedDuplicate && (
            <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "10px 12px" }}>
              A deleted farmer record with this RSBSA number exists ({deletedDuplicate.firstName} {deletedDuplicate.lastName}).
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
                <input
                  className="form-control"
                  placeholder="00-00-00-000-000000"
                  value={form.rsbsaNo}
                  onChange={(e) => update("rsbsaNo", formatRsbsaNo(e.target.value))}
                  inputMode="numeric"
                  maxLength={19}
                />
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
                <input type="tel" inputMode="numeric" className="form-control" value={form.contactNo} onChange={(e) => update("contactNo", e.target.value)} placeholder="09XX XXX XXXX" />
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
