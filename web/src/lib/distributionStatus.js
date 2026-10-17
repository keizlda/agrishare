// A distribution has ONE status with three steps (see migration
// 20261017000000_single_distribution_status.sql):
//   Ongoing     – scheduled or in progress
//   Distributed – items released to farmers; signed acknowledgement
//                 receipts not yet filed
//   Completed   – signed acknowledgement receipts collected and filed
// Acknowledgement is part of that status: Completed = acknowledged, with the
// date in receiptsCollectedAt.
export const DISTRIBUTION_STATUSES = ["Ongoing", "Distributed", "Completed"];

// Items have reached farmers (counts toward "quantity distributed").
export function isReleased(distribution) {
  return distribution.status === "Distributed" || distribution.status === "Completed";
}

// "Collected on October 5, 2026" / "Not yet collected", for reports, the
// printed Distribution Report and the details panel.
export function receiptsLabel({ status, receiptsCollectedAt }) {
  if (status !== "Completed") return "Not yet collected";
  if (!receiptsCollectedAt) return "Collected";
  const date = new Date(receiptsCollectedAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
  return `Collected on ${date}`;
}
