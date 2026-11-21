import { supabase } from "../supabaseClient.js";
import { isNetworkError } from "../friendlyError.js";

// Association requests (capstone review, Nov 2026): machinery, a project or
// other support the Farmers' Association President asks the MAO for. The
// database decides who may do what (association_requests RLS + its guard
// trigger): the Farmers' Association President creates, sees their own and
// edits/cancels only while Pending; the MAO Admin sees all and moves them to
// Under review, Approved or Rejected (remarks required to reject).

export const ASSOCIATION_TYPES = [
  { value: "machinery", label: "Machinery" },
  { value: "project", label: "Project" },
  { value: "other", label: "Other" },
];
const TYPE_LABEL = Object.fromEntries(ASSOCIATION_TYPES.map((t) => [t.value, t.label]));

export const ASSOCIATION_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "Under review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
const STATUS_LABEL = Object.fromEntries(ASSOCIATION_STATUSES.map((s) => [s.value, s.label]));


export const LIMITS = { description: 2000, item: 80, remarks: 1000, quantity: 10000, beneficiaries: 100000 };

const BUCKET = "association-attachments";
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const SELECT = `
  association_request_id, request_type, title, description, item, item_id, item_other, quantity, estimated_beneficiaries, preferred_date,
  attachment_path, attachment_name, attachment_type, status, requested_by, reviewed_by, reviewed_at, admin_remarks,
  created_at, updated_at,
  requester:profiles!requested_by ( full_name ),
  reviewer:profiles!reviewed_by ( full_name )
`;

function mapAssociationRequest(row) {
  return {
    id: row.association_request_id,
    type: row.request_type,
    typeLabel: TYPE_LABEL[row.request_type] ?? row.request_type,
    // The item (from the MAO's list, or the "Other" text) is the request's
    // headline.
    title: row.item ?? row.title ?? "",
    description: row.description,
    item: row.item ?? row.title ?? "",
    itemId: row.item_id ?? null,
    itemOther: row.item_other ?? "",
    quantity: row.quantity,
    estimatedBeneficiaries: row.estimated_beneficiaries,
    preferredDate: row.preferred_date,
    attachmentPath: row.attachment_path,
    attachmentName: row.attachment_name ?? "",
    attachmentType: row.attachment_type ?? "",
    statusKey: row.status,
    status: STATUS_LABEL[row.status] ?? row.status,
    requestedBy: row.requested_by,
    requesterName: row.requester?.full_name ?? "Farmers' Association President",
    reviewerName: row.reviewer?.full_name ?? "MAO Admin",
    reviewedAt: row.reviewed_at,
    adminRemarks: row.admin_remarks ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Not cancelled, newest first. RLS returns the FA President's own requests,
// or every request for the MAO Admin.
export async function listAssociationRequests() {
  const { data, error } = await supabase.from("association_requests").select(SELECT).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(mapAssociationRequest);
}

// ---------------------------------------------------------------------------
// Attachment: one image or PDF, up to 5 MB (the bucket refuses others too).
// ---------------------------------------------------------------------------
async function looksLike(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...head.slice(from, to));
  if (file.type === "application/pdf") return ascii(0, 5) === "%PDF-";
  if (file.type === "image/webp") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (file.type === "image/png") return [0x89, 0x50, 0x4e, 0x47].every((b, i) => head[i] === b);
  return [0xff, 0xd8, 0xff].every((b, i) => head[i] === b);
}

export async function validateAttachment(file) {
  if (!ATTACHMENT_TYPES.includes(file.type)) return "Attach a JPG, PNG or WebP photo, or a PDF.";
  if (file.size > MAX_ATTACHMENT_BYTES) return "The file must be 5 MB or smaller.";
  if (!(await looksLike(file))) return "That file doesn't look like the photo or PDF its name says. Choose another file.";
  return null;
}

async function uploadAttachment(file) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error("Your session has expired. Please log in again.");
  const ext = file.type === "application/pdf" ? "pdf" : (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${uid}/${random}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) {
    if (isNetworkError(error)) throw error;
    if (String(error.statusCode ?? error.status) === "413" || /maximum allowed size|too large/i.test(error.message ?? "")) throw new Error("The file must be 5 MB or smaller.");
    if (/mime type|not supported|invalid file type/i.test(error.message ?? "")) throw new Error("Attach a JPG, PNG or WebP photo, or a PDF.");
    throw error;
  }
  return { path, name: file.name.slice(0, 200), type: file.type };
}

async function removeAttachment(path) {
  if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}

// A short-lived link for viewing/downloading the attachment.
export async function getAttachmentUrl(path, expiresInSeconds = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

const toRow = (form) => ({
  request_type: form.type,
  item_id: form.itemId ? Number(form.itemId) : null,
  item_other: form.itemOther.trim() || null,
  description: form.description.trim(),
  quantity: form.type !== "machinery" || form.quantity === "" ? null : Number(form.quantity),
  estimated_beneficiaries: form.estimatedBeneficiaries === "" ? null : Number(form.estimatedBeneficiaries),
  preferred_date: form.preferredDate || null,
});

// The file (if any) is uploaded first; if saving the request then fails, the
// file is removed again so nothing is left behind.
export async function createAssociationRequest(form, file) {
  const uploaded = file ? await uploadAttachment(file) : null;
  const row = { ...toRow(form), ...(uploaded ? { attachment_path: uploaded.path, attachment_name: uploaded.name, attachment_type: uploaded.type } : {}) };
  const { data, error } = await supabase.from("association_requests").insert(row).select(SELECT).single();
  if (error) {
    await removeAttachment(uploaded?.path);
    throw error;
  }
  return mapAssociationRequest(data);
}

// While Pending only (RLS). `file` replaces the attachment; `clearAttachment`
// removes it. The old file is deleted only after the save succeeds.
export async function updateAssociationRequest(request, form, { file = null, clearAttachment = false } = {}) {
  const uploaded = file ? await uploadAttachment(file) : null;
  const row = toRow(form);
  if (uploaded) Object.assign(row, { attachment_path: uploaded.path, attachment_name: uploaded.name, attachment_type: uploaded.type });
  else if (clearAttachment) Object.assign(row, { attachment_path: null, attachment_name: null, attachment_type: null });
  const { data, error } = await supabase.from("association_requests").update(row).eq("association_request_id", request.id).select(SELECT).maybeSingle();
  if (error || !data) {
    await removeAttachment(uploaded?.path);
    if (error) throw error;
    throw new Error("This request can only be changed while it is Pending. Refresh to see its current status.");
  }
  if ((uploaded || clearAttachment) && request.attachmentPath) await removeAttachment(request.attachmentPath);
  return mapAssociationRequest(data);
}

export async function cancelAssociationRequest(requestId) {
  const { data, error } = await supabase
    .from("association_requests")
    .update({ deleted_at: new Date().toISOString() })
    .eq("association_request_id", requestId)
    .select("association_request_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only a Pending request can be cancelled. Refresh to see its current status.");
}

// MAO Admin: "under_review", "approved" or "rejected" (remarks required to
// reject). Who reviewed and when is stamped by the database. Leaving the
// remarks empty keeps any written at an earlier step.
export async function reviewAssociationRequest(requestId, status, remarks) {
  const patch = { status };
  if (remarks?.trim()) patch.admin_remarks = remarks.trim();
  const { data, error } = await supabase
    .from("association_requests")
    .update(patch)
    .eq("association_request_id", requestId)
    .select(SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This request was cancelled or changed by someone else. Refresh and try again.");
  return mapAssociationRequest(data);
}

// ---------------------------------------------------------------------------
// The item list (managed by the MAO Admin; the FA President picks from it).
// ---------------------------------------------------------------------------
export async function listAssociationItems() {
  const { data, error } = await supabase.from("association_request_items").select("item_id, name, is_other, sort_order").is("deleted_at", null).order("sort_order").order("name");
  if (error) throw error;
  return data.map((i) => ({ id: i.item_id, name: i.name, isOther: !!i.is_other, sortOrder: i.sort_order }));
}

export async function saveAssociationItem({ id, name, sortOrder }) {
  const query = id
    ? supabase.from("association_request_items").update({ name: name.trim() }).eq("item_id", id)
    : supabase.from("association_request_items").insert({ name: name.trim(), sort_order: sortOrder ?? 500 });
  const { data, error } = await query.select("item_id, name, is_other, sort_order").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only the MAO Admin can change the item list.");
  return { id: data.item_id, name: data.name, isOther: !!data.is_other, sortOrder: data.sort_order };
}

// Removed items stay on past requests (their name is kept there).
export async function removeAssociationItem(id) {
  const { data, error } = await supabase.from("association_request_items").update({ deleted_at: new Date().toISOString() }).eq("item_id", id).select("item_id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Only the MAO Admin can change the item list.");
}
