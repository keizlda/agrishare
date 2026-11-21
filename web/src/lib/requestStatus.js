// A farmer request's status as people read it: Pending, Approved or
// Rejected. (The endorsement step was removed in Nov 2026; requests that
// were Endorsed then became Pending.) Pill colors key off this label.
export function reviewLabel(r) {
  return r.status === "Forwarded" ? "Pending" : r.status;
}
