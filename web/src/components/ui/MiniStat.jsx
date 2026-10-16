const MINI_STAT_COLORS = {
  green: { bg: "var(--agri-primary-light)", fg: "var(--agri-primary-dark)" },
  blue: { bg: "var(--agri-blue-bg)", fg: "var(--agri-blue)" },
  red: { bg: "var(--agri-red-bg)", fg: "var(--agri-red-soft)" },
  purple: { bg: "var(--agri-purple-bg)", fg: "var(--agri-purple)" },
};

// Icon chip + label / value / sub — the dashboard's stat-card style, shared
// so other pages (e.g. the Distributions summary strip) match it exactly.
// size="lg" is the Dashboard's top stat row (bigger chip and number).
export default function MiniStat({ icon: Icon, label, value, sub, color = "green", size }) {
  const c = MINI_STAT_COLORS[color] ?? MINI_STAT_COLORS.green;
  return (
    <div className={`agri-mini-stat${size === "lg" ? " agri-mini-stat-lg" : ""}`}>
      <div className="agri-mini-stat-icon" style={{ background: c.bg, color: c.fg }}>
        <Icon size={size === "lg" ? 21 : 18} />
      </div>
      <div>
        <div className="agri-mini-stat-label">{label}</div>
        <div className="agri-mini-stat-value">{value}</div>
        <div className="agri-mini-stat-sub">{sub}</div>
      </div>
    </div>
  );
}
