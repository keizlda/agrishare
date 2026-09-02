import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users, UserCheck, UserX, Truck, ShieldCheck, FilePlus, UserPlus, ClipboardList, Eye } from "lucide-react";
import StatCard from "../components/ui/StatCard.jsx";
import OverviewDrawer from "../components/ui/OverviewDrawer.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  computeDistributionByCommodity,
  computeDistributionTrend,
  computeFarmerStats,
  distributionTotalQty,
} from "../data/mockData.js";
import { listFarmers } from "../lib/api/farmers.js";
import { listDistributions } from "../lib/api/distributions.js";
import { listCommodities } from "../lib/api/commodities.js";

const PIE_COLORS = ["#2f9e44", "#e5484d"];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [farmers, setFarmers] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [commodities, setCommodities] = useState([]);

  useEffect(() => {
    listFarmers().then(setFarmers).catch(() => {});
    listDistributions().then(setDistributions).catch(() => {});
    listCommodities().then(setCommodities).catch(() => {});
  }, []);

  const stats = computeFarmerStats(farmers);
  const recent = distributions.slice(0, 4);

  const { year: trendYear, trend: distributionTrend } = computeDistributionTrend(distributions);
  const distributionByCommodity = computeDistributionByCommodity(commodities, distributions);
  const topCommodities = [...distributionByCommodity].filter((c) => c.name !== "Others").sort((a, b) => b.value - a.value).slice(0, 3);
  const maxCommodity = topCommodities[0]?.value ?? 1;

  const isMAO = user?.role !== "FA President";

  return (
    <div>
      <OverviewDrawer>
        <StatCard icon={Users} label="Total Farmers" value={stats.total.toLocaleString()} sub="All registered farmers" color="green" />
        <StatCard icon={UserCheck} label="Active Farmers" value={stats.active.toLocaleString()} sub="Currently active" color="blue" />
        <StatCard icon={UserX} label="Inactive Farmers" value={stats.inactive.toLocaleString()} sub="Inactive accounts" color="red" />
        <StatCard icon={Truck} label="Total Distributions" value={distributions.length} sub="This month" color="purple" />
      </OverviewDrawer>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Distribution overview chart */}
        <div className="agri-card" style={{ padding: 18 }}>
          <div className="agri-panel-header">
            <div style={{ fontWeight: 700 }}>Distribution Overview</div>
            <div className="agri-muted" style={{ fontSize: "0.8rem" }}>Quantity distributed (kg), {trendYear}</div>
          </div>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={distributionTrend}>
              <CartesianGrid vertical={false} stroke="var(--agri-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6b7a70" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#6b7a70" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: "1px solid var(--agri-border)", fontSize: 13 }}
                formatter={(v) => [`${v.toLocaleString()} kg`, "Quantity"]}
              />
              <Bar dataKey="quantity" fill="var(--agri-primary)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Validation status donut */}
        <div className="agri-card" style={{ padding: 18 }}>
          <div className="agri-panel-header">
            <div style={{ fontWeight: 700 }}>Validation Status</div>
          </div>
          <div style={{ position: "relative" }}>
            <ResponsiveContainer width="100%" height={170}>
              <PieChart>
                <Pie
                  data={[{ name: "Validated", value: stats.validated }, { name: "Not Validated", value: stats.total - stats.validated }]}
                  dataKey="value"
                  innerRadius={48}
                  outerRadius={70}
                  paddingAngle={2}
                >
                  {PIE_COLORS.map((color) => (
                    <Cell key={color} fill={color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--agri-border)", fontSize: 13 }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none", marginTop: -14 }}>
              <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--agri-primary-dark)" }}>
                {Math.round((stats.validated / (stats.total || 1)) * 100)}%
              </div>
              <div className="agri-muted" style={{ fontSize: "0.68rem" }}>Validated</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 18, fontSize: "0.8rem" }}>
            <div><span style={{ color: PIE_COLORS[0] }}>●</span> Validated ({stats.validated})</div>
            <div><span style={{ color: PIE_COLORS[1] }}>●</span> Not Validated ({stats.total - stats.validated})</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 16 }}>
        {/* Recent distributions */}
        <div className="agri-card" style={{ padding: 18 }}>
          <div className="agri-panel-header">
            <div style={{ fontWeight: 700 }}>Recent Distributions</div>
            <button className="btn btn-link p-0" style={{ fontSize: "0.78rem" }} onClick={() => navigate("/distributions")}>
              View all
            </button>
          </div>
          {recent.map((d) => {
            const primaryItem = d.items[0];
            const shortName = primaryItem.name.replace(/\s*\(.*\)$/, "");
            return (
              <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--agri-border)" }}>
                <div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>{shortName}</div>
                  <div className="agri-muted" style={{ fontSize: "0.72rem" }}>
                    {distributionTotalQty(d).toLocaleString()} {primaryItem.unit} · {d.date}
                  </div>
                </div>
                <span className="agri-pill green">{d.beneficiaries} Farmers</span>
              </div>
            );
          })}
        </div>

        {/* Top commodities */}
        <div className="agri-card" style={{ padding: 18 }}>
          <div className="agri-panel-header">
            <div style={{ fontWeight: 700 }}>Top Commodities</div>
          </div>
          {topCommodities.map((c) => (
            <div key={c.name} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", marginBottom: 4 }}>
                <span>{c.name}</span>
                <span className="agri-muted">{c.value.toLocaleString()} kg</span>
              </div>
              <div style={{ height: 7, background: "var(--agri-primary-soft)", borderRadius: 6 }}>
                <div
                  style={{
                    height: "100%",
                    width: `${(c.value / maxCommodity) * 100}%`,
                    background: "var(--agri-primary)",
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
          ))}
          <div className="agri-muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>
            {commodities.length} commodity types available for distribution
          </div>
        </div>

        {/* Quick actions */}
        <div className="agri-card" style={{ padding: 18 }}>
          <div className="agri-panel-header">
            <div style={{ fontWeight: 700 }}>Quick Actions</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {isMAO ? (
              <>
                <QuickAction icon={ShieldCheck} label="Validate Farmers" onClick={() => navigate("/validation")} />
                <QuickAction icon={FilePlus} label="Generate Report" onClick={() => navigate("/reports")} />
                <QuickAction icon={UserPlus} label="Add Farmer" onClick={() => navigate("/farmers")} />
                <QuickAction icon={ClipboardList} label="Record Distribution" onClick={() => navigate("/distributions")} />
              </>
            ) : (
              <>
                <QuickAction icon={Users} label="View Farmers" onClick={() => navigate("/farmers")} />
                <QuickAction icon={Eye} label="View Distributions" onClick={() => navigate("/distributions")} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="agri-card"
      style={{
        border: "1px solid var(--agri-border)", padding: "14px 10px", display: "flex",
        flexDirection: "column", alignItems: "center", gap: 8, background: "var(--agri-primary-soft)",
        color: "var(--agri-primary-dark)", fontSize: "0.78rem", fontWeight: 600,
      }}
    >
      <Icon size={20} />
      {label}
    </button>
  );
}
