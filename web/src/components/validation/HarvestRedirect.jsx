import { Navigate, useSearchParams } from "react-router-dom";

// The old Harvest page is now part of Validation: /harvest opens the inbox
// on Harvest, and /harvest?id=N (older notifications) opens that report.
export default function HarvestRedirect() {
  const [params] = useSearchParams();
  const id = Number(params.get("id"));
  const status = params.get("status");
  const query = `?type=harvest${status ? `&status=${encodeURIComponent(status)}` : ""}`;
  return <Navigate to={id ? `/validation/harvest/${id}?type=harvest&status=all` : `/validation${query}`} replace />;
}
