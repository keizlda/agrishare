const STATUS_COLOR = {
  Active: "green",
  Validated: "green",
  Completed: "green",
  Approved: "green",
  Inactive: "red",
  "Not Validated": "red",
  Rejected: "red",
  Pending: "orange",
  Ongoing: "orange",
  "For Review": "purple",
  Forwarded: "purple",
};

export default function Pill({ status, children }) {
  const color = STATUS_COLOR[status] ?? "gray";
  return <span className={`agri-pill ${color}`}>{children ?? status}</span>;
}
