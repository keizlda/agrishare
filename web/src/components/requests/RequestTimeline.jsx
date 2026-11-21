import { formatDateTime } from "../../lib/dates.js";

// A farmer request's history, top to bottom: submitted (by whom, when) →
// endorsed / not endorsed by the Farmers' Association President → approved /
// rejected by the MAO Admin, each with its remarks. Steps still to come are
// shown greyed out.
function timelineSteps(r) {
  const steps = [
    {
      key: "submitted",
      state: "done",
      title: "Submitted",
      by: r.filedByFa ? `Filed by ${r.filedByName} (Farmers' Association President) for ${r.farmerName}` : `by ${r.farmerName}`,
      when: r.requestDate,
    },
  ];

  if (r.status === "Pending") {
    steps.push({ key: "fa", state: "waiting", title: "Waiting for endorsement", by: "Farmers' Association President" });
  } else if (r.rejectedBy === "fa") {
    steps.push({ key: "fa", state: "rejected", title: "Not endorsed", by: `by ${r.faPresidentName}`, when: r.faDecisionAt, remarks: r.faRemarks });
  } else {
    steps.push({ key: "fa", state: "done", title: "Endorsed", by: `by ${r.faPresidentName}`, when: r.faDecisionAt ?? r.forwardedToAdminAt, remarks: r.faRemarks });
  }

  if (r.rejectedBy !== "fa") {
    if (r.status === "Approved" || r.status === "Rejected") {
      steps.push({ key: "mao", state: r.status === "Approved" ? "done" : "rejected", title: r.status, by: `by ${r.maoName}`, when: r.adminDecisionAt, remarks: r.maoRemarks });
    } else {
      steps.push({ key: "mao", state: r.status === "Forwarded" ? "waiting" : "upcoming", title: "Approval", by: r.status === "Forwarded" ? "Waiting for the MAO Admin's decision" : "MAO Admin, after endorsement" });
    }
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
            {s.state === "done" || s.state === "rejected" ? ` · ${s.when ? formatDateTime(s.when) : "date not recorded"}` : ""}
          </div>
          {s.remarks && <div className="agri-timeline-remarks">“{s.remarks}”</div>}
        </li>
      ))}
    </ol>
  );
}
