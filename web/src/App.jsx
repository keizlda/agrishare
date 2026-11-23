import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout.jsx";
import RequireRole from "./components/layout/RequireRole.jsx";
import ErrorBoundary from "./components/ui/ErrorBoundary.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Farmers from "./pages/Farmers.jsx";
import Validation from "./pages/Validation.jsx";
import Distributions from "./pages/Distributions.jsx";
import Requests from "./pages/Requests.jsx";
import Reports from "./pages/Reports.jsx";
import Settings from "./pages/Settings.jsx";
import Announcements from "./pages/Announcements.jsx";
import ActivityLog from "./pages/ActivityLog.jsx";
import HarvestRedirect from "./components/validation/HarvestRedirect.jsx";
import PrintDistribution from "./pages/PrintDistribution.jsx";
import PrintReport from "./pages/PrintReport.jsx";

// Two crash screens: this outer one catches anything outside a page (the
// layout, the print pages, Login); AppLayout puts one around each page so
// the top bar stays usable when a page breaks.
export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Print pages open in their own tab, outside AppLayout's checks:
            the distribution report is for both staff roles, reports are
            MAO Admin only (like the Reports page). */}
        <Route
          path="/print/distributions/:id"
          element={<RequireRole roles={["MAO Admin", "FA President"]}><PrintDistribution /></RequireRole>}
        />
        <Route path="/print/reports" element={<RequireRole roles={["MAO Admin"]}><PrintReport /></RequireRole>} />

        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/farmers" element={<Farmers />} />
          <Route path="/validation" element={<Validation />} />
          <Route path="/validation/:kind/:id" element={<Validation />} />
          <Route path="/distributions" element={<Distributions />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/harvest" element={<HarvestRedirect />} />
          <Route path="/reports" element={<Reports />} />
          {/* Commodities are managed in the distribution form now. */}
          <Route path="/commodities" element={<Navigate to="/distributions" replace />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/activity-log" element={<ActivityLog />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Login />} />
      </Routes>
    </ErrorBoundary>
  );
}
