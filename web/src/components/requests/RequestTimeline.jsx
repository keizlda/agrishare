import { formatDateTime } from "../../lib/dates.js";

// A farmer request's history, top to bottom: submitted (by the farmer or
// filed by the Farmers' Association President) → the Farmers' Association
// President's recommendation or remark, if any → approved / rejected by the
// MAO Admin with remarks (or still waiting).
function timelineSteps(r) {
  const steps = [
    r.filedByFa
      ? { key: "submitted", state: "done", title: `Filed by ${r.filedByName} (Farmers' Association President) for ${r.farmerName}`, by: "", when: r.requestDate }
      : { key: "submitted", state: "done", title: "Submitted", by: `by ${r.farmerName}`, when: r.requestDate },
  ];
  if (r.rejectedBy === "fa") {
    // Turned down at the old endorsement step (before Nov 2026).
    steps.push({ key: "fa", state: "rejected", title: "Rejected", by: `by ${r.faPresidentName} (Farmers' Association President)`, when: r.faDecisionAt, remarks: r.faRemarks });
    return steps;
  }
  if (r.recommended || r.faRemarks) {
    steps.push({
      key: "fa",
      state: "done",
      title: r.recommended ? "Recommended by Farmers' Association President" : "Remark from the Farmers' Association President",
      by: `by ${r.faPresidentName}`,
      when: r.recommendedAt,
      remarks: r.faRemarks,
    });
  }
  if (r.status === "Approved" || r.status === "Rejected") {
    steps.push({ key: "mao", state: r.status === "Approved" ? "done" : "rejected", title: r.status, by: `by ${r.maoName} (MAO Admin)`, when: r.adminDecisionAt, remarks: r.maoRemarks });
  } else {
    steps.push({ key: "mao", state: "waiting", title: "Waiting for the MAO Admin's decision", by: "MAO Admin" });
  }
  return steps;
}

export default function RequestTimeline({ request }) {
  return (
    <ol className="agri-timeline">
      {timelineSteps(request).map((s) => (
        <li key={s.key} className={`agri-timeline-step ${s.state}`}>
          <span className="agri-timeline-dot" aria-hidden="true" />
          <div className="agri-timeline-title">{s.title}</div>
          <div className="agri-timeline-meta">
            {s.by}
            {s.state === "done" || s.state === "rejected" ? `${s.by ? " · " : ""}${s.when ? formatDateTime(s.when) : "date not recorded"}` : ""}
          </div>
          {s.remarks && <div className="agri-timeline-remarks">“{s.remarks}”</div>}
        </li>
      ))}
    </ol>
  );
}
