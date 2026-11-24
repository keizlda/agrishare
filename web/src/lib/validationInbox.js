// The Validation inbox: proof-of-planting submissions and harvest reports in
// one list, newest first. Each item keeps its own record (`raw`) and the
// fields the list and the opened view need.
import { listSubmissions } from "./api/cropValidation.js";
import { listHarvestReports } from "./api/harvest.js";
import { inBarangay } from "./listMatch.js";

export const KINDS = { planting: "Proof of planting", harvest: "Harvest" };

export const TYPE_TABS = [
  { value: "all", label: "All" },
  { value: "planting", label: "Proof of planting" },
  { value: "harvest", label: "Harvest" },
];

// Planting: Pending / Validated / Rejected. Harvest: Submitted / Verified /
// Rejected. The filter groups them: Approved = validated or verified,
// Rejected = rejected (either kind).
export const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
const GROUP = { Pending: "pending", Validated: "approved", Rejected: "rejected", submitted: "pending", verified: "approved", rejected: "rejected" };
// Older links: ?status=Pending, ?status=submitted, ?status=declined …
const LEGACY_STATUS = { pending: "pending", submitted: "pending", validated: "approved", verified: "approved", rejected: "rejected", returned: "rejected", declined: "rejected", all: "all", approved: "approved" };

export function readFilters(params) {
  const type = TYPE_TABS.some((t) => t.value === params.get("type")) ? params.get("type") : "all";
  const status = LEGACY_STATUS[(params.get("status") ?? "").toLowerCase()] ?? "pending";
  const q = params.get("q") ?? "";
  const barangay = params.get("barangay") || "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  return { type, status, q, barangay, page };
}

// URL query for the filters (defaults left out).
export function filterQuery({ type, status, q, barangay, page }) {
  const p = new URLSearchParams();
  if (type && type !== "all") p.set("type", type);
  if (status && status !== "pending") p.set("status", status);
  if (q) p.set("q", q);
  if (barangay && barangay !== "all") p.set("barangay", barangay);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

// The mobile app saves "Rice · 1.50 ha · planted Oct 2, 2026" as the
// submission's note when the farmer leaves Remarks empty.
const PLANTING_NOTE = /^(.+?) · ([\d.,]+) ha · planted (.+)$/;

export function plantingDetails(s) {
  const pending = s.status === "Pending";
  const note = pending ? (s.remarks ?? "").trim() : "";
  const m = PLANTING_NOTE.exec(note);
  return {
    crop: s.crop || (m ? m[1] : "") || s.farmer?.commodity || "",
    areaPlanted: s.areaPlanted ?? (m ? Number(m[2].replace(/,/g, "")) : null),
    plantingDate: m ? m[3] : null,
    farmerRemarks: m ? "" : note,
  };
}

function fromPlanting(s) {
  const f = s.farmer;
  const d = plantingDetails(s);
  return {
    key: `planting-${s.id}`,
    kind: "planting",
    id: s.id,
    farmerId: f?.id ?? null,
    farmerName: f?.fullName ?? "Unknown farmer",
    firstName: f?.firstName ?? "",
    lastName: f?.lastName ?? "",
    avatarUrl: f?.avatarUrl ?? null,
    rsbsaNo: f?.rsbsaNo ?? "",
    barangay: f?.barangay ?? "",
    barangayId: f?.barangayId ?? null,
    farmSize: f?.farmSize ?? null,
    summary: [d.crop || "Crop not given", d.areaPlanted != null ? `${fmt(d.areaPlanted)} ha` : null].filter(Boolean).join(" · "),
    status: s.status,
    group: GROUP[s.status] ?? "pending",
    date: s.submittedAt,
    submittedBy: f?.fullName ?? "the farmer",
    submittedRole: "Farmer",
    raw: s,
  };
}

function fromHarvest(h) {
  // The commodity's full name, e.g. "Rice Seeds – Hybrid".
  const crop = h.commodityName;
  return {
    key: `harvest-${h.id}`,
    kind: "harvest",
    id: h.id,
    farmerId: h.farmerId,
    farmerName: h.farmerName,
    firstName: h.firstName,
    lastName: h.lastName,
    avatarUrl: h.avatarUrl,
    rsbsaNo: h.rsbsaNo,
    barangay: h.barangay,
    barangayId: h.barangayId,
    farmSize: h.farmSize,
    summary: `${crop} · ${fmt(h.yieldKg)} kg`,
    status: h.status,
    group: GROUP[h.statusKey] ?? "pending",
    date: h.createdAt,
    submittedBy: h.filedByStaff ? h.submitterName : h.farmerName,
    submittedRole: h.filedByFa ? "Farmers' Association President" : h.filedByStaff ? "MAO Admin" : "Farmer",
    raw: h,
  };
}

export const toItem = { planting: fromPlanting, harvest: fromHarvest };

export async function loadInbox() {
  const [planting, harvest] = await Promise.all([listSubmissions(), listHarvestReports()]);
  return [...planting.map(fromPlanting), ...harvest.map(fromHarvest)].sort((a, b) => new Date(b.date) - new Date(a.date));
}

// `barangays`: the list, for records matched by their barangay text.
export function applyFilters(items, { type, status, q, barangay }, barangays = []) {
  const query = q.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");
  return items.filter(
    (i) =>
      (type === "all" || i.kind === type) &&
      (status === "all" || i.group === status) &&
      inBarangay(barangays, barangay, i.barangayId, i.barangay) &&
      (!query || i.farmerName.toLowerCase().includes(query) || i.rsbsaNo.toLowerCase().includes(query) || (digits.length >= 3 && i.rsbsaNo.replace(/\D/g, "").includes(digits))),
  );
}
