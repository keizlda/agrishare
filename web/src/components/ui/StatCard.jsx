import { TrendingUp } from "lucide-react";

const COLOR_MAP = {
  green: { bg: "var(--agri-primary-light)", fg: "var(--agri-primary-dark)" },
  blue: { bg: "var(--agri-blue-bg)", fg: "var(--agri-blue)" },
  red: { bg: "var(--agri-red-bg)", fg: "var(--agri-red)" },
  orange: { bg: "var(--agri-orange-bg)", fg: "var(--agri-orange)" },
  purple: { bg: "var(--agri-purple-bg)", fg: "var(--agri-purple)" },
};

export default function StatCard({ icon: Icon, label, value, sub, color = "green" }) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.green;
  return (
    <div className="agri-overview-item">
      <div className="agri-overview-item-icon" style={{ background: c.bg, color: c.fg }}>
        <Icon size={18} />
      </div>
      <div className="agri-overview-item-text">
        <div className="agri-overview-item-label">{label}</div>
        <div className="agri-overview-item-value">{value}</div>
        {sub && <div className="agri-overview-item-sub">{sub}</div>}
      </div>
      <TrendingUp size={16} color={c.fg} style={{ flexShrink: 0 }} />
    </div>
  );
}
