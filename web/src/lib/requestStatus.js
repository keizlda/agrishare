// A farmer request's status as people read it. The database keeps four
// values (Pending / Forwarded / Approved / Rejected); the Farmers'
// Association President endorses (or doesn't) and only the MAO approves or
// rejects, so the label shown is:
//   Pending -> Endorsed -> Approved or Rejected, or Not endorsed when the
//   Farmers' Association President turned it down (rejectedBy "fa").
// Pill colors key off this label (Pill.jsx).
export function reviewLabel(r) {
  if (r.status === "Forwarded") return "Endorsed";
  if (r.status === "Rejected" && r.rejectedBy === "fa") return "Not endorsed";
  return r.status;
}
