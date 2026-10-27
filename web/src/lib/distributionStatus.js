import { formatDateLong, formatDateNumeric } from "./dates.js";

// A distribution has TWO statuses (paper Sections 1.5.1 and 3.2.1; migration
// 20261017020000_two_distribution_statuses.sql):
//   Ongoing   – scheduled or in progress
//   Completed – items released and beneficiaries signed the acknowledgement
//               receipt
// Each tagged farmer's acknowledgement follows from it: Pending while
// Ongoing, Acknowledged on the completion date (completedAt) once Completed.
// The database's distribution_beneficiary_acknowledgement view gives the
// same values.
export const DISTRIBUTION_STATUSES = ["Ongoing", "Completed"];

export function isCompleted(distribution) {
  return distribution.status === "Completed";
}

// "October 5, 2026" — when the distribution was marked Completed (the
// distribution date for older records without a completion time).
export function completedOn({ status, completedAt, date }) {
  if (status !== "Completed") return "";
  return formatDateLong(completedAt ?? date, "");
}

// Per-farmer acknowledgement for reports and the printed beneficiary list.
export function acknowledgementLabel({ status }) {
  return status === "Completed" ? "Acknowledged" : "Pending";
}

// "10/05/2026" — the Date Received printed per farmer (the completion date),
// blank while the distribution is still Ongoing.
export function dateReceived({ status, completedAt, date }) {
  if (status !== "Completed") return "";
  return formatDateNumeric(completedAt ?? date);
}
