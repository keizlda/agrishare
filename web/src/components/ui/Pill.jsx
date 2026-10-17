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

export default function Pill({ status, children }) {
  const color = STATUS_COLOR[status] ?? "gray";
  return <span className={`agri-pill ${color}`}>{children ?? status}</span>;
}
