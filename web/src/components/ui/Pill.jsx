export const STATUS_COLOR = {
  Active: "green",
  Validated: "green",
  Completed: "green",
  Approved: "green",
  Published: "green",
  "Distribution Schedule": "green",
  "Validation Reminder": "blue",
  Urgent: "red",
  Inactive: "red",
  Rejected: "red",
  Pending: "orange",
  Ongoing: "orange",
  Partial: "orange",
  Received: "green",
  Complete: "green",
  "For Review": "purple",
  // Requests: Pending -> Endorsed -> Approved / Rejected, or Not endorsed.
  Endorsed: "blue",
  "Not endorsed": "gray",
};

export default function Pill({ status, children }) {
  const color = STATUS_COLOR[status] ?? "gray";
  return <span className={`agri-pill ${color}`}>{children ?? status}</span>;
}
