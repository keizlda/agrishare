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
  Distributed: "blue",
  Partial: "orange",
  Received: "green",
  Complete: "green",
  "For Review": "purple",
  Forwarded: "purple",
};

// `wrap` lets a long label (e.g. "Approved by Farmers' Association
// President") break onto two lines instead of stretching its column.
export default function Pill({ status, children, wrap }) {
  const color = STATUS_COLOR[status] ?? "gray";
  return <span className={`agri-pill ${color}${wrap ? " agri-pill-wrap" : ""}`}>{children ?? status}</span>;
}
