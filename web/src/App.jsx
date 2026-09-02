import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Farmers from "./pages/Farmers.jsx";
import Validation from "./pages/Validation.jsx";
import Distributions from "./pages/Distributions.jsx";
import Requests from "./pages/Requests.jsx";
import Reports from "./pages/Reports.jsx";
import Commodities from "./pages/Commodities.jsx";
import Settings from "./pages/Settings.jsx";
import PrintDistribution from "./pages/PrintDistribution.jsx";
import PrintReport from "./pages/PrintReport.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/print/distributions/:id" element={<PrintDistribution />} />
      <Route path="/print/reports" element={<PrintReport />} />

      <Route element={<AppLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/farmers" element={<Farmers />} />
        <Route path="/validation" element={<Validation />} />
        <Route path="/distributions" element={<Distributions />} />
        <Route path="/requests" element={<Requests />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/commodities" element={<Commodities />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Login />} />
    </Routes>
  );
}
