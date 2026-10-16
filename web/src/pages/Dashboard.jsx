import { useEffect, useRef, useState } from "react";
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
import { Users, UserCheck, UserX, Truck, ShieldCheck, FilePlus, UserPlus, ClipboardList, Eye, Megaphone, Newspaper } from "lucide-react";
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
import { useFitCount } from "../hooks/useFitCount.js";
import Toast from "../components/ui/Toast.jsx";
import MiniStat from "../components/ui/MiniStat.jsx";
import AnnouncementModal from "../components/announcements/AnnouncementModal.jsx";

const PIE_COLORS = ["var(--agri-primary)", "var(--agri-red-soft)"];
const AXIS_TICK = { fontSize: 12, fill: "var(--agri-text-muted)" };
const TOOLTIP_STYLE = { borderRadius: 10, border: "1px solid var(--agri-border)", background: "var(--agri-card)", fontSize: 13 };
const MAX_ROWS = 5;
// When the Dashboard fills the viewport instead of scrolling — must match the
// fill-mode @media block in theme.css's Dashboard section.
const FILL_QUERY = "(min-width: 1280px) and (min-height: 620px), (min-width: 1024px) and (min-height: 800px)";

// Full-height layout (desktop): chart + validation, then the three
// list/action cards — see the "Dashboard" section of theme.css.
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [farmers, setFarmers] = useState([]);
  const [distributions, setDistributions] = useState([]);
  const [commodities, setCommodities] = useState([]);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [toast, setToast] = useState(null);
  const recentListRef = useRef(null);
  const commodityListRef = useRef(null);

  useEffect(() => {
    listFarmers().then(setFarmers).catch(() => {});
    listDistributions().then(setDistributions).catch(() => {});
    listCommodities().then(setCommodities).catch(() => {});
  }, []);

  const stats = computeFarmerStats(farmers);
  const notValidated = stats.total - stats.validated;
  const validatedPct = stats.total ? Math.round((stats.validated / stats.total) * 100) : 0;
  const notValidatedPct = stats.total ? 100 - validatedPct : 0;

  const { year: trendYear, trend: distributionTrend } = computeDistributionTrend(distributions);
  const distributionByCommodity = computeDistributionByCommodity(commodities, distributions, MAX_ROWS);
  const rankedCommodities = [...distributionByCommodity].filter((c) => c.name !== "Others").sort((a, b) => b.value - a.value);
  const maxCommodity = rankedCommodities[0]?.value ?? 1;

  // Each list shows as many rows as its card has room for (up to 5).
  const recentFit = useFitCount(recentListRef, { max: MAX_ROWS, query: FILL_QUERY, remeasureKey: Math.min(distributions.length, MAX_ROWS) });
  const commodityFit = useFitCount(commodityListRef, { max: MAX_ROWS, query: FILL_QUERY, remeasureKey: Math.min(rankedCommodities.length, MAX_ROWS) });
  const recent = distributions.slice(0, recentFit);
  const topCommodities = rankedCommodities.slice(0, commodityFit);

  const isMAO = user?.role !== "FA President";

  return (
    <>
      <div className="agri-dash">
        <div className="agri-dash-row agri-dash-row-top">
          {/* Distribution overview chart */}
          <div className="agri-card agri-dash-card agri-dash-chart">
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Distribution Overview</div>
              <div className="agri-muted" style={{ fontSize: "0.8rem" }}>Quantity distributed (kg), {trendYear}</div>
            </div>
            {/* The inner wrapper is absolutely positioned so the plot's size
                comes only from the card, letting the chart shrink as well as
                grow when the window resizes. */}
            <div className="agri-dash-chart-plot">
              <div className="agri-dash-chart-inner">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionTrend} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                    <CartesianGrid vertical={false} stroke="var(--agri-border)" />
                    <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v.toLocaleString()} kg`, "Quantity"]} />
                    <Bar dataKey="quantity" fill="var(--agri-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Validation status: donut + legend, with the farmer stats beside it */}
          <div className="agri-card agri-dash-card agri-dash-validation">
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Validation Status</div>
            </div>
            <div className="agri-dash-validation-body">
              <div className="agri-dash-donut-col">
                <div className="agri-dash-donut">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[{ name: "Validated", value: stats.validated }, { name: "Not Validated", value: notValidated }]}
                        dataKey="value"
                        innerRadius="66%"
                        outerRadius="96%"
                        paddingAngle={2}
                        stroke="none"
                      >
                        {PIE_COLORS.map((color) => (
                          <Cell key={color} fill={color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="agri-dash-donut-center">
                    <div className="agri-dash-donut-pct">{validatedPct}%</div>
                    <div className="agri-muted agri-dash-donut-caption">Validated</div>
                  </div>
                </div>
                <div className="agri-dash-legend">
                  <LegendItem color={PIE_COLORS[0]} label="Validated" count={stats.validated} pct={validatedPct} />
                  <LegendItem color={PIE_COLORS[1]} label="Not Validated" count={notValidated} pct={notValidatedPct} />
                </div>
              </div>

              <div className="agri-dash-stats">
                <MiniStat icon={Users} color="green" label="Total Farmers" value={stats.total.toLocaleString()} sub="All registered" />
                <MiniStat icon={UserCheck} color="blue" label="Active Farmers" value={stats.active.toLocaleString()} sub="Currently active" />
                <MiniStat icon={UserX} color="red" label="Inactive Farmers" value={stats.inactive.toLocaleString()} sub="Inactive accounts" />
                <MiniStat icon={Truck} color="purple" label="Total Distributions" value={distributions.length.toLocaleString()} sub="This month" />
              </div>
            </div>
          </div>
        </div>

        <div className="agri-dash-row agri-dash-row-bottom">
          {/* Recent distributions */}
          <div className="agri-card agri-dash-card agri-dash-recent">
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Recent Distributions</div>
              <button className="btn btn-link p-0" style={{ fontSize: "0.78rem" }} onClick={() => navigate("/distributions")}>
                View all
              </button>
            </div>
            <div className="agri-dash-list" ref={recentListRef}>
              {recent.map((d) => {
                const primaryItem = d.items[0];
                const shortName = primaryItem.name.replace(/\s*\(.*\)$/, "");
                return (
                  <div key={d.id} className="agri-dash-list-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="agri-dash-list-title">{shortName}</div>
                      <div className="agri-muted agri-dash-list-sub">
                        {distributionTotalQty(d).toLocaleString()} {primaryItem.unit} · {d.date}
                      </div>
                    </div>
                    <span className="agri-pill green">{d.beneficiaries} Farmers</span>
                  </div>
                );
              })}
              {distributions.length === 0 && <div className="agri-dash-empty agri-muted">No distributions recorded yet.</div>}
            </div>
          </div>

          {/* Top commodities */}
          <div className="agri-card agri-dash-card agri-dash-commodities">
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Top Commodities</div>
            </div>
            <div className="agri-dash-commodity-list" ref={commodityListRef}>
              {topCommodities.map((c) => (
                <div key={c.name} className="agri-dash-commodity">
                  <div>
                    <div className="agri-dash-commodity-label">
                      <span>{c.name}</span>
                      <span className="agri-muted">{c.value.toLocaleString()} kg</span>
                    </div>
                    <div className="agri-dash-commodity-track">
                      <div className="agri-dash-commodity-bar" style={{ width: `${(c.value / maxCommodity) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
              {rankedCommodities.length === 0 && <div className="agri-dash-empty agri-muted">No distributions recorded yet.</div>}
            </div>
            <div className="agri-muted agri-dash-card-note">
              {commodities.length} commodity types available for distribution
            </div>
          </div>

          {/* Quick actions */}
          <div className="agri-card agri-dash-card agri-dash-actions">
            <div className="agri-panel-header">
              <div style={{ fontWeight: 700 }}>Quick Actions</div>
            </div>
            <div className={`agri-dash-tiles${isMAO ? "" : " two"}`}>
              {isMAO ? (
                <>
                  <QuickAction icon={ShieldCheck} label="Validate Farmers" onClick={() => navigate("/validation")} />
                  <QuickAction icon={FilePlus} label="Generate Report" onClick={() => navigate("/reports")} />
                  <QuickAction icon={UserPlus} label="Add Farmer" onClick={() => navigate("/farmers")} />
                  <QuickAction icon={ClipboardList} label="Record Distribution" onClick={() => navigate("/distributions")} />
                  <QuickAction icon={Megaphone} label="Post Announcement" onClick={() => setShowAnnouncement(true)} />
                  <QuickAction icon={Newspaper} label="View Announcements" onClick={() => navigate("/announcements")} />
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

      {showAnnouncement && (
        <AnnouncementModal
          onClose={() => setShowAnnouncement(false)}
          onSaved={(saved, { published }) => {
            setShowAnnouncement(false);
            setToast({ tone: "success", message: published ? "Announcement published." : "Draft saved." });
          }}
        />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onDone={() => setToast(null)} />}
    </>
  );
}

function LegendItem({ color, label, count, pct }) {
  return (
    <div className="agri-dash-legend-item">
      <span className="agri-dash-legend-dot" style={{ background: color }} />
      <span>{label}</span>
      <strong>{count.toLocaleString()}</strong>
      <span className="agri-muted">({pct}%)</span>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="agri-dash-tile">
      <Icon size={20} />
      {label}
    </button>
  );
}
