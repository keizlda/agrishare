// Shared "nothing here" block for lists/tables: icon, headline, one-line hint,
// and an optional action (e.g. a "Clear filters" button).
export default function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="agri-empty-state">
      {Icon && (
        <div className="agri-empty-state-icon">
          <Icon size={26} />
        </div>
      )}
      <div className="agri-empty-state-title">{title}</div>
      {hint && <div className="agri-empty-state-hint">{hint}</div>}
      {action}
    </div>
  );
}
