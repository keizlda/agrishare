import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { Copy, Crown, KeyRound, Pencil, Plus, Power, Printer, Search, Trash2, Users, X } from "lucide-react";
import Pill from "../components/ui/Pill.jsx";
import FarmerAvatar from "../components/ui/FarmerAvatar.jsx";
import ConfirmDialog from "../components/ui/ConfirmDialog.jsx";
import TableFooter from "../components/ui/TableFooter.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import RowActionsMenu from "../components/ui/RowActionsMenu.jsx";
import DateInput from "../components/ui/DateInput.jsx";
import FarmerProfileDrawer from "../components/farmers/FarmerProfileDrawer.jsx";
import ListPicker from "../components/lists/ListPicker.jsx";
import ManageSitiosModal from "../components/lists/ManageSitiosModal.jsx";
import { TypeChecklist, TypeChips } from "../components/farmers/FarmerTypes.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useSupabaseList } from "../hooks/useSupabaseList.js";
import { usePagination } from "../hooks/usePagination.js";
import { useFitPageSize } from "../hooks/useFitPageSize.js";
import { useCardLabels } from "../hooks/useCardLabels.js";
import Toast from "../components/ui/Toast.jsx";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { listAllEntries } from "../lib/api/lists.js";
import { listFaPresidents, promoteFarmer } from "../lib/api/faPresidents.js";
import BarangayFilter from "../components/lists/BarangayFilter.jsx";
import { entryForText, inBarangay } from "../lib/listMatch.js";
import { PLACE } from "../lib/place.js";
import { formatDate, todayIso } from "../lib/dates.js";
import { friendlyError } from "../lib/friendlyError.js";
import { CONTACT_ERROR, CONTACT_PLACEHOLDER, contactInput, isValidContact } from "../lib/contact.js";
import { rowActionsCellProps, rowLinkProps } from "../lib/rowLink.js";
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

// Types of farmer, sitio/purok and farmers' association come from lists in
// the database (Settings); these two are the RSBSA form's fixed choices.
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

// Nothing is pre-filled: every choice starts empty with a placeholder.
// Sitio/purok, farm location and association hold list ids; *Legacy holds
// an older value that isn't on the list (shown until one is chosen).
// typeIds: the chosen types of farmer. A new farmer is saved Active (the
// status is only chosen in Edit).
const EMPTY_FORM = {
  rsbsaNo: "",
  firstName: "",
  middleName: "",
  lastName: "",
  sex: "",
  birthDate: "",
  contactNo: "",
  sitioId: "",
  sitioLegacy: "",
  barangayId: "",
  barangayLegacy: "",
  typeIds: [],
  farmSize: "",
  farmSitioId: "",
  farmLocationLegacy: "",
  ownershipType: "",
  pcicInsured: "",
  associationId: "",
  orgLegacy: "",
  status: "",
};

// The list entry a saved value stands for: its id, or (records saved before
// the lists) the entry with the same name ignoring case and spaces.
function resolveEntry(entries, id, text) {
  if (id) return { id: String(id), legacy: "" };
  const match = entryForText(entries, text);
  return match ? { id: String(match.id), legacy: "" } : { id: "", legacy: text ?? "" };
}

// Sitios/puroks and associations of one barangay.
const ofBarangay = (entries, barangayId) => entries.filter((e) => barangayId && String(e.barangayId) === String(barangayId));

function farmerToForm(f, lists) {
  const brgy = resolveEntry(lists.barangays, f.barangayId, f.barangay);
  const sitio = resolveEntry(ofBarangay(lists.sitios, brgy.id), f.sitioId, f.sitioPurok);
  const farm = resolveEntry(ofBarangay(lists.sitios, brgy.id), f.farmSitioId, f.farmLocation);
  const assoc = resolveEntry(ofBarangay(lists.associations, brgy.id), f.associationId, f.orgAffiliation);
  return {
    rsbsaNo: f.rsbsaNo ?? "",
    firstName: f.firstName ?? "",
    middleName: f.middleName ?? "",
    lastName: f.lastName ?? "",
    sex: f.sex ?? "",
    birthDate: f.birthDate ?? "",
    contactNo: f.contactNo ?? "",
    sitioId: sitio.id,
    sitioLegacy: sitio.legacy,
    barangayId: brgy.id,
    barangayLegacy: brgy.legacy,
    typeIds: (f.types ?? []).map((t) => String(t.id)),
    farmSize: f.farmSize ?? "",
    farmSitioId: farm.id,
    farmLocationLegacy: farm.legacy,
    ownershipType: f.ownershipType || "",
    pcicInsured: f.pcicInsured || "",
    associationId: assoc.id,
    orgLegacy: assoc.legacy,
    status: f.status || "",
  };
}

// Self-contained print window (no route/data round-trip) so the temporary
// password never sits in a URL or gets persisted anywhere retrievable later
// — it only ever exists in memory for the few seconds between the Edge
// Function's response and this slip being printed or dismissed.
// The slip is written as HTML, so every value goes in escaped: a name typed
// as "<img onerror=…>" must print as text, never run in the slip window
// (which shares this page's origin and session).
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function printAccountSlip(slip) {
  const { farmerName, rsbsaNo, loginId, password } = Object.fromEntries(Object.entries(slip).map(([k, v]) => [k, escapeHtml(v)]));
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

// Letters only, lowercase, accents removed: "Niño O'Brien" → "ninoobrien".
function nameKey(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

// Number of single-letter changes (add, remove, replace) between a and b.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Possible duplicate (not an exact one — findDuplicateFarmer handles that):
// another farmer with the same birth date whose first + last name is at
// most two letters off — a typo, a doubled letter, or the same name with a
// different middle name. The admin is warned and can save anyway.
function findSimilarFarmer(farmers, form, excludeId) {
  const key = nameKey(`${form.firstName}${form.lastName}`);
  return farmers.find((f) => {
    if (excludeId != null && f.id === excludeId) return false;
    if (f.birthDate !== form.birthDate) return false;
    return editDistance(key, nameKey(`${f.firstName}${f.lastName}`)) <= 2;
  });
}

// Input rules. Names: letters (including ñ and accented letters), spaces,
// and . ' - ("Ma.", "O'Brien-Dela Cruz") — no digits, symbols or emoji.
// RSBSA registrants are adults, so ages 18–100 are accepted.
const NAME_PATTERN = /^\p{L}[\p{L}\p{M} .'-]*$/u;
const MAX_LENGTH = { name: 50 };
const MIN_AGE = 18;
const MAX_AGE = 100;
const MAX_FARM_HECTARES = 1000;

function ageOn(birthIso, todayIsoDate) {
  const [by, bm, bd] = birthIso.split("-").map(Number);
  const [ty, tm, td] = todayIsoDate.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

function nameError(value, label, required) {
  const v = value.trim();
  if (!v) return required ? `${label} is required.` : null;
  if (v.length > MAX_LENGTH.name) return `${label} can't be longer than ${MAX_LENGTH.name} characters.`;
  if (!NAME_PATTERN.test(v)) return `${label} can only have letters, spaces, and . ' -`;
  return null;
}

// Trimmed copy for saving (and for the duplicate check): no leading/trailing
// spaces, single spaces inside names, digits only in the contact number.
function cleanFarmerForm(form) {
  const squeeze = (v) => v.trim().replace(/\s+/g, " ");
  return {
    ...form,
    rsbsaNo: form.rsbsaNo.trim(),
    firstName: squeeze(form.firstName),
    middleName: squeeze(form.middleName),
    lastName: squeeze(form.lastName),
    contactNo: form.contactNo.replace(/\D/g, ""),
  };
}

function validateFarmerForm(form, { editing = false } = {}) {
  const errors = {};
  const trimmedRsbsa = form.rsbsaNo.trim();
  if (!trimmedRsbsa) {
    errors.rsbsaNo = "RSBSA number is required.";
  } else if (!RSBSA_PATTERN.test(trimmedRsbsa)) {
    errors.rsbsaNo = "Enter the complete RSBSA number (format: 09-73-12-021-000143).";
  }
  for (const [field, label, required] of [["firstName", "First name", true], ["middleName", "Middle name", false], ["lastName", "Last name", true]]) {
    const err = nameError(form[field], label, required);
    if (err) errors[field] = err;
  }
  if (!form.sex) errors.sex = "Choose the sex.";
  if (!form.birthDate) {
    errors.birthDate = "Enter the birth date as MM/DD/YYYY.";
  } else {
    const today = todayIso();
    const age = ageOn(form.birthDate, today);
    if (form.birthDate > today) errors.birthDate = "Enter a realistic birth date — not in the future.";
    else if (age < MIN_AGE) errors.birthDate = `The farmer must be at least ${MIN_AGE} years old.`;
    else if (age > MAX_AGE) errors.birthDate = `Enter a realistic birth date — that's over ${MAX_AGE} years old.`;
  }

  if (!isValidContact(form.contactNo)) errors.contactNo = CONTACT_ERROR;

  const size = Number(form.farmSize);
  if (!(size > 0)) {
    errors.farmSize = "Farm size must be a positive number.";
  } else if (size > MAX_FARM_HECTARES) {
    errors.farmSize = `Enter a realistic farm size (up to ${MAX_FARM_HECTARES.toLocaleString()} ha).`;
  }
  if (!form.sitioId) errors.sitioId = "Choose the sitio/purok from the list.";
  if (!form.barangayId) errors.barangayId = "Choose the barangay.";
  if (!form.typeIds?.length) errors.typeIds = "Choose at least one type of farmer.";
  if (!form.ownershipType) errors.ownershipType = "Choose the ownership / tenurial status.";
  if (!form.pcicInsured) errors.pcicInsured = "Choose whether the farm is PCIC insured.";
  if (editing && !form.status) errors.status = "Choose a status.";

  return errors;
}

export default function Farmers() {
  const { user } = useAuth();
  const location = useLocation();
  const isMAO = user?.role !== "FA President";
  const { data: farmers, setData: setFarmers, loading, error: loadError } = useSupabaseList(listFarmers);
  const [search, setSearch] = useState(location.state?.presetSearch ?? "");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  // Filters: barangay, status and type of farmer.
  const [barangayFilter, setBarangayFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("all");
  // Sitios/puroks, farmers' associations, types of farmer, barangays (Settings).
  const [lists, setLists] = useState({ sitios: [], associations: [], crops: [], barangays: [], farmerTypes: [] });
  useEffect(() => {
    listAllEntries().then(setLists).catch(() => {});
  }, []);
  const addToList = (kind, entry) => setLists((l) => ({ ...l, [kind]: [...l[kind].filter((e) => e.id !== entry.id), entry].sort((a, b) => a.name.localeCompare(b.name)) }));
  // "Manage sitios/puroks": the Farmers' Association President manages their
  // own barangay's list, the MAO Admin any barangay's. null | { barangayId }
  const [sitiosModal, setSitiosModal] = useState(null);
  const ownBarangay = !isMAO && user?.barangayId ? { id: user.barangayId, name: user.barangayName } : null;
  // Opened from the account menu (Sitios/Puroks): /farmers?sitios=1.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("sitios") !== "1") return;
    if (isMAO || ownBarangay) setSitiosModal({ barangayId: "" });
    setSearchParams((p) => {
      p.delete("sitios");
      return p;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
  const [viewing, setViewing] = useState(null); // farmer row shown in the read-only profile drawer
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingReset, setPendingReset] = useState(null);
  // Making a farmer the barangay's Farmers' Association President (MAO).
  const [pendingPromote, setPendingPromote] = useState(null);
  const [promoting, setPromoting] = useState(false);
  const [presidents, setPresidents] = useState([]);
  useEffect(() => {
    if (isMAO) listFaPresidents().then(setPresidents).catch(() => {});
  }, [isMAO]);
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
      const matchesStatus = statusFilter === "All" || f.status === statusFilter;
      const matchesType = typeFilter === "all" || f.types.some((t) => String(t.id) === typeFilter);
      return matchesSearch && matchesStatus && matchesType && inBarangay(lists.barangays, barangayFilter, f.barangayId, f.barangay);
    });
  }, [farmers, debouncedSearch, statusFilter, typeFilter, barangayFilter, lists]);
  const filtersOn = statusFilter !== "All" || barangayFilter !== "all" || typeFilter !== "all";


  // Rows per page = however many fit in the full-height table area (min 5).
  const tableRef = useRef(null);
  const pageSize = useFitPageSize(tableRef, { remeasureKey: filtered.length > 0 });
  const { page, setPage, totalPages, pageItems } = usePagination(filtered, pageSize, [debouncedSearch, statusFilter, typeFilter, barangayFilter].join("|"));
  useCardLabels(tableRef);

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

  async function handlePromote() {
    const f = pendingPromote;
    setPromoting(true);
    setActionError("");
    try {
      const r = await promoteFarmer(f.id);
      setFarmers((prev) => prev.map((x) => (x.id === f.id ? { ...x, isFaPresident: true } : x)));
      listFaPresidents().then(setPresidents).catch(() => {});
      setToast({ tone: "success", message: `${r.name} is now the Farmers' Association President of Barangay ${r.barangay}. They sign in on the website with login ID ${r.loginId} and their password.` });
      // Anyone replaced is a farmer again: refresh their rows' labels.
      listFarmers().then(setFarmers).catch(() => {});
    } catch (err) {
      setActionError(friendlyError(err, "Couldn't make this farmer the Farmers' Association President."));
    } finally {
      setPromoting(false);
      setPendingPromote(null);
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
        <div className="agri-toolbar" style={{ marginBottom: 16 }}>
          <div className="agri-toolbar-search">
            <Search size={15} />
            <input
              className="form-control"
              placeholder="Search name or RSBSA no."
              aria-label="Search farmers by name or RSBSA no."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <BarangayFilter barangays={lists.barangays} value={barangayFilter} onChange={setBarangayFilter} />

          <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "122px" }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <select className="form-select agri-toolbar-filter" style={{ "--agri-filter-width": "176px" }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type of farmer">
            <option value="all">All types of farmer</option>
            {lists.farmerTypes.filter((t) => t.isActive).map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
          </select>

          {isMAO && (
            <button className="btn btn-agri-primary ms-auto d-flex align-items-center gap-2 text-nowrap" onClick={() => setModal({ mode: "add" })}>
              <Plus size={16} /> Add Farmer
            </button>
          )}
        </div>

        <div className="agri-table-wrap" ref={tableRef}>
          <table className="agri-table agri-table-cards">
            <thead>
              <tr>
                <th>RSBSA No.</th><th>Full Name</th><th>Sex</th><th>Birth Date</th><th>Contact No.</th>
                <th>Barangay</th><th>Type of Farmer</th><th>Farm Size</th><th>Farm Location</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((f) => (
                // Clicking (or Enter on) the row focuses it, so the drawer hands
                // focus back to this row when it closes.
                <tr key={f.id} {...rowLinkProps(() => setViewing(f), { selected: viewing?.id === f.id })}>
                  <td>{f.rsbsaNo}</td>
                  <td>
                    <span className="agri-farmer-cell">
                      <FarmerAvatar url={f.avatarUrl} firstName={f.firstName} lastName={f.lastName} size={28} />
                      <span className="agri-row-title">{f.firstName} {f.lastName}</span>
                      {f.isFaPresident && <span className="agri-president-tag" title="This farmer is the barangay's Farmers' Association President">Farmers&apos; Association President</span>}
                    </span>
                  </td>
                  <td>{f.sex}</td>
                  <td>{formatDate(f.birthDate)}</td>
                  <td>{f.contactNo}</td>
                  <td>{f.barangay}</td>
                  <td><TypeChips types={f.types} max={2} /></td>
                  <td>{f.farmSize} ha</td>
                  <td>{f.farmLocation}</td>
                  <td><Pill status={f.status} /></td>
                  {/* The ⋯ menu must not also trigger the row's "open profile" click. */}
                  <td {...rowActionsCellProps}>
                    <RowActionsMenu
                      label={`Actions for ${f.firstName} ${f.lastName}`}
                      actions={[
                        isMAO && { key: "edit", label: "Edit", icon: Pencil, onClick: () => setModal({ mode: "edit", farmer: f }) },
                        isMAO &&
                          f.profileId && { key: "reset-password", label: "Reset Password", icon: KeyRound, onClick: () => setPendingReset(f) },
                        isMAO &&
                          f.profileId &&
                          !f.isFaPresident &&
                          f.status === "Active" && { key: "promote", label: "Make Farmers' Association President", icon: Crown, onClick: () => setPendingPromote(f) },
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
              hint={search || filtersOn ? "Try a different search or clear the filters." : "Add a farmer to start building the beneficiary list."}
            />
          )}
        </div>
        <TableFooter page={page} pageSize={pageSize} total={filtered.length} totalPages={totalPages} onPageChange={setPage} noun={["farmer", "farmers"]} />
      </div>

      {viewing && (
        <FarmerProfileDrawer farmer={viewing} showAccount={isMAO} onClose={() => setViewing(null)} />
      )}

      {modal && (
        <FarmerModal
          mode={modal.mode}
          farmer={modal.farmer}
          farmers={farmers}
          lists={lists}
          onListAdded={addToList}
          canManageSitios={isMAO}
          onManageSitios={(barangayId) => setSitiosModal({ barangayId })}
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

      {sitiosModal && (
        <ManageSitiosModal
          barangays={lists.barangays}
          sitios={lists.sitios}
          fixedBarangay={ownBarangay}
          initialBarangayId={sitiosModal.barangayId}
          onSaved={(entry) => addToList("sitios", entry)}
          onRemoved={(id, result) =>
            setLists((l) => ({ ...l, sitios: result === "hidden" ? l.sitios.map((s) => (s.id === id ? { ...s, isActive: false } : s)) : l.sitios.filter((s) => s.id !== id) }))
          }
          onClose={() => setSitiosModal(null)}
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

      {pendingPromote && (() => {
        const brgyId = pendingPromote.barangayId ?? lists.barangays.find((b) => b.name === pendingPromote.barangay)?.id;
        const current = presidents.filter((p) => p.barangayId === brgyId);
        return (
          <ConfirmDialog
            title={`Make ${pendingPromote.firstName} ${pendingPromote.lastName} the Farmers' Association President?`}
            message={`They become the Farmers' Association President of Barangay ${pendingPromote.barangay} and sign in on the website with login ID ${pendingPromote.rsbsaNo.replace(/\D/g, "").slice(-6)} and their password. They can no longer use the farmer app or be tagged as a farmer.${current.length ? ` ${current.map((p) => p.name).join(", ")}, the current president, ${current.some((p) => p.farmerId) ? "goes back to being a farmer" : "will no longer be able to sign in"}.` : ""}`}
            confirmLabel="Make president"
            danger={false}
            busy={promoting}
            onConfirm={handlePromote}
            onCancel={() => setPendingPromote(null)}
          />
        );
      })()}

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

function FarmerModal({ mode, farmer, farmers, lists, onListAdded, canManageSitios = false, onManageSitios, onClose, onSaved, onViewExisting }) {
  const [form, setForm] = useState(() => (mode === "edit" ? farmerToForm(farmer, lists) : EMPTY_FORM));
  // Lists that arrive after the form opened: match the saved values now.
  useEffect(() => {
    setForm((f) => {
      const next = { ...f };
      for (const [idKey, legacyKey, kind] of [["barangayId", "barangayLegacy", "barangays"], ["sitioId", "sitioLegacy", "sitios"], ["farmSitioId", "farmLocationLegacy", "sitios"], ["associationId", "orgLegacy", "associations"]]) {
        if (!next[idKey] && next[legacyKey]) {
          const pool = kind === "sitios" || kind === "associations" ? ofBarangay(lists[kind], next.barangayId) : lists[kind];
          const match = entryForText(pool, next[legacyKey]);
          if (match) Object.assign(next, { [idKey]: String(match.id), [legacyKey]: "" });
        }
      }
      return next;
    });
  }, [lists]);
  // Barangay: the active barangays, plus the farmer's own if deactivated.
  const barangayOptions = useMemo(() => lists.barangays.filter((b) => b.isActive || String(b.id) === form.barangayId), [lists.barangays, form.barangayId]);
  // Sitios/puroks and associations: the chosen barangay's lists.
  const sitioEntries = useMemo(() => ofBarangay(lists.sitios, form.barangayId), [lists.sitios, form.barangayId]);
  const noSitios = !!form.barangayId && !sitioEntries.some((s) => s.isActive);
  const associationEntries = useMemo(() => ofBarangay(lists.associations, form.barangayId), [lists.associations, form.barangayId]);
  // Another barangay: its sitio/purok, farm location and association are
  // chosen again from that barangay's lists.
  function pickBarangay(value) {
    setForm((f) => {
      const keep = (id, entries) => (id && ofBarangay(entries, value).some((e) => String(e.id) === id) ? id : "");
      return { ...f, barangayId: value, barangayLegacy: "", sitioId: keep(f.sitioId, lists.sitios), farmSitioId: keep(f.farmSitioId, lists.sitios), associationId: keep(f.associationId, lists.associations) };
    });
    setErrors((e) => (e.barangayId ? { ...e, barangayId: undefined } : e));
  }
  const needBarangay = form.barangayId ? undefined : "Choose the barangay first";
  const [errors, setErrors] = useState({});
  const [duplicate, setDuplicate] = useState(null);
  // A possible duplicate the admin was warned about; a second Save with the
  // same match goes ahead.
  const [similar, setSimilar] = useState(null);
  const [deletedDuplicate, setDeletedDuplicate] = useState(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  // Blocks a second Save while the first is still running (the duplicate
  // and login-ID checks run before the save itself).
  const savingRef = useRef(false);

  useEscapeToClose(true, onClose);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  }
  // A list field: choosing (or clearing) an entry drops the older text.
  function pickFrom(field, legacyField) {
    return (value) => {
      setForm((f) => ({ ...f, [field]: value, [legacyField]: "" }));
      setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await submit();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function submit() {
    setFormError("");
    setDuplicate(null);
    setDeletedDuplicate(null);

    const fieldErrors = validateFarmerForm(form, { editing: mode === "edit" });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    const cleanForm = cleanFarmerForm(form);
    const excludeId = mode === "edit" ? farmer.id : null;
    const match = findDuplicateFarmer(farmers, cleanForm, excludeId);
    if (match) {
      setSimilar(null);
      setDuplicate(match);
      return;
    }
    const near = findSimilarFarmer(farmers, cleanForm, excludeId);
    if (near && similar?.id !== near.id) {
      setSimilar(near);
      return;
    }

    const rsbsaTrimmed = cleanForm.rsbsaNo;
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

    try {
      const saved = mode === "edit" ? await updateFarmer(farmer.id, cleanForm) : await createFarmer(cleanForm);
      onSaved(saved);
    } catch (err) {
      setFormError(friendlyError(err, "Couldn't save this farmer. Please try again."));
    }
  }

  return (
    <div className="agri-modal-backdrop" onClick={onClose}>
      <div
        className="agri-card agri-modal agri-modal-full"
        style={{ "--agri-modal-width": "640px" }}
        role="dialog"
        aria-label={mode === "edit" ? "Edit Farmer" : "Add Farmer"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="agri-modal-header">
          <div className="agri-modal-title">{mode === "edit" ? "Edit Farmer" : "Add Farmer"}</div>
          <button type="button" className="agri-icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="agri-modal-body">
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
          {similar && !duplicate && (
            <div className="agri-pill orange" role="alert" style={{ display: "block", marginBottom: 14, padding: "10px 12px" }}>
              Possible duplicate: a farmer with a very similar name and the same birth date already exists. Check that
              this isn't the same person, then click Save Farmer again to save anyway.
              <button
                type="button"
                className="btn btn-link p-0"
                style={{ display: "block", fontSize: "0.8rem", marginTop: 4 }}
                onClick={() => onViewExisting(similar.rsbsaNo)}
              >
                View existing record: {similar.firstName} {similar.lastName} — RSBSA {similar.rsbsaNo}
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

          <form id="farmer-form" onSubmit={handleSubmit} noValidate>
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
                <input className="form-control" maxLength={MAX_LENGTH.name} value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
              </Field>
              <Field label="Middle Name" col={4} error={errors.middleName}>
                <input className="form-control" maxLength={MAX_LENGTH.name} value={form.middleName} onChange={(e) => update("middleName", e.target.value)} />
              </Field>
              <Field label="Last Name" col={4} required error={errors.lastName}>
                <input className="form-control" maxLength={MAX_LENGTH.name} value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
              </Field>
              <Field label="Sex" col={4} required error={errors.sex}>
                <select className={`form-select${errors.sex ? " is-invalid" : ""}`} value={form.sex} onChange={(e) => update("sex", e.target.value)} aria-label="Sex">
                  <option value="" disabled>Select sex</option>
                  <option>Male</option><option>Female</option>
                </select>
              </Field>
              <Field label="Birth Date" col={4} required error={errors.birthDate}>
                <DateInput value={form.birthDate} onChange={(v) => update("birthDate", v)} max={todayIso()} invalid={!!errors.birthDate} aria-label="Birth date" />
              </Field>
              <Field label="Contact No." col={4} required error={errors.contactNo}>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  className={`form-control${errors.contactNo ? " is-invalid" : ""}`}
                  value={form.contactNo}
                  onChange={(e) => update("contactNo", contactInput(e.target.value))}
                  placeholder={CONTACT_PLACEHOLDER}
                  aria-label="Contact no."
                />
              </Field>
            </Section>

            <Section title="Address">
              <Field label="Barangay" col={6} required error={errors.barangayId}>
                <select className={`form-select${errors.barangayId ? " is-invalid" : ""}`} value={form.barangayId} onChange={(e) => pickBarangay(e.target.value)} aria-label="Barangay">
                  <option value="" disabled>{form.barangayLegacy ? `${form.barangayLegacy} (not on the list)` : "Select barangay"}</option>
                  {barangayOptions.map((b) => <option key={b.id} value={String(b.id)}>{b.name}{b.isActive ? "" : " (deactivated)"}</option>)}
                </select>
              </Field>
              <Field label="Sitio / Purok" col={6} required error={errors.sitioId} htmlFor="farmer-sitio">
                <ListPicker
                  id="farmer-sitio"
                  kind="sitios"
                  entries={sitioEntries}
                  value={form.sitioId}
                  legacyText={form.sitioLegacy}
                  onChange={pickFrom("sitioId", "sitioLegacy")}
                  invalid={!!errors.sitioId}
                  disabled={!form.barangayId || noSitios}
                  placeholder={needBarangay ?? (noSitios ? "No sitios/puroks yet" : undefined)}
                  barangayId={form.barangayId}
                />
                {noSitios && (
                  <div className="agri-field-hint agri-no-sitios">
                    No sitios/puroks yet for this barangay. Ask the Farmers&apos; Association President to add them.
                    {canManageSitios && (
                      <button type="button" className="agri-link-btn" onClick={() => onManageSitios(form.barangayId)}>Manage sitios/puroks</button>
                    )}
                  </div>
                )}
              </Field>
              {/* Municipality and province are always these: fixed, not inputs. */}
              <Field label="Municipality" col={6}>
                <div className="agri-fixed-value">{PLACE.municipality}</div>
              </Field>
              <Field label="Province" col={6}>
                <div className="agri-fixed-value">{PLACE.province}</div>
              </Field>
            </Section>

            <Section title="Farm Information">
              <Field label="Type of farmer" col={12} required error={errors.typeIds} hint="Choose all that apply.">
                <TypeChecklist id="farmer-types" options={lists.farmerTypes} value={form.typeIds} onChange={(v) => update("typeIds", v)} invalid={!!errors.typeIds} />
              </Field>
              <Field label="Farm Size (ha)" col={6} required error={errors.farmSize}>
                <input type="number" step="0.01" min="0" className={`form-control${errors.farmSize ? " is-invalid" : ""}`} value={form.farmSize} onChange={(e) => update("farmSize", e.target.value)} aria-label="Farm size (ha)" />
              </Field>
              <Field label="Farm Location (Sitio / Purok)" col={6} htmlFor="farmer-farm-location" hint="Optional. Where the farm is, if different from the address.">
                <ListPicker
                  id="farmer-farm-location"
                  kind="sitios"
                  entries={sitioEntries}
                  value={form.farmSitioId}
                  legacyText={form.farmLocationLegacy}
                  onChange={pickFrom("farmSitioId", "farmLocationLegacy")}
                  optional
                  disabled={!form.barangayId}
                  placeholder={needBarangay}
                  barangayId={form.barangayId}
                  ariaLabel="Farm location (sitio/purok)"
                />
              </Field>
              <Field label="Ownership / Tenurial Status" col={6} required error={errors.ownershipType}>
                <select className={`form-select${errors.ownershipType ? " is-invalid" : ""}`} value={form.ownershipType} onChange={(e) => update("ownershipType", e.target.value)} aria-label="Ownership / tenurial status">
                  <option value="" disabled>Select ownership</option>
                  {/* A saved value from before these choices stays selectable. */}
                  {[...OWNERSHIP_OPTIONS, ...(form.ownershipType && !OWNERSHIP_OPTIONS.includes(form.ownershipType) ? [form.ownershipType] : [])].map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
              <Field label="PCIC Insured" col={6} required error={errors.pcicInsured}>
                <select className={`form-select${errors.pcicInsured ? " is-invalid" : ""}`} value={form.pcicInsured} onChange={(e) => update("pcicInsured", e.target.value)} aria-label="PCIC insured">
                  <option value="" disabled>Select PCIC insurance</option>
                  {PCIC_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
            </Section>

            <Section title={mode === "edit" ? "Affiliation & Status" : "Affiliation"} last>
              <Field label="Farmers' Association" col={6} htmlFor="farmer-association" hint="Optional. Type to search.">
                <ListPicker
                  id="farmer-association"
                  kind="associations"
                  entries={associationEntries}
                  value={form.associationId}
                  legacyText={form.orgLegacy}
                  onChange={pickFrom("associationId", "orgLegacy")}
                  onAdded={(entry) => onListAdded("associations", entry)}
                  canAdd
                  optional
                  disabled={!form.barangayId}
                  placeholder={needBarangay}
                  barangayId={form.barangayId}
                  ariaLabel="Farmers' association"
                />
              </Field>
              {mode === "edit" ? (
                <Field label="Status" col={6} required error={errors.status}>
                  <select className={`form-select${errors.status ? " is-invalid" : ""}`} value={form.status} onChange={(e) => update("status", e.target.value)} aria-label="Status">
                    <option value="" disabled>Select status</option>
                    <option>Active</option><option>Inactive</option>
                  </select>
                </Field>
              ) : (
                <Field label="Status" col={6}>
                  <div className="agri-fixed-value">Active</div>
                  <div className="agri-field-hint">New farmers are Active. Change it later in Edit.</div>
                </Field>
              )}
            </Section>
          </form>
        </div>

        <div className="agri-modal-footer">
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
          letterSpacing: "0.03em", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--agri-divider)",
        }}
      >
        {title}
      </div>
      <div className="row g-3">{children}</div>
    </div>
  );
}

// One column on phones; `col` (of 12) from 576px up.
function Field({ label, col, required, error, hint, htmlFor, children }) {
  return (
    <div className={`col-12 col-sm-${col}`}>
      <label className="agri-form-label" htmlFor={htmlFor}>
        {label}
        {required && <span style={{ color: "var(--agri-red)" }}> *</span>}
      </label>
      {children}
      {error ? <div style={{ color: "var(--agri-red)", fontSize: "0.72rem", marginTop: 4 }}>{error}</div> : hint && <div className="agri-field-hint">{hint}</div>}
    </div>
  );
}
