import { useEffect } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

// `action` ({ label, onClick }) adds an inline button (e.g. Undo); a toast
// with an action stays up longer so there's time to click it.
export default function Toast({ message, tone = "success", onDone, action, duration }) {
  const ms = duration ?? (action ? 5000 : 3000);

  useEffect(() => {
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [onDone, ms]);

  const Icon = tone === "error" ? XCircle : CheckCircle2;

  return (
    <div className={`agri-toast ${tone}`} role="status">
      <Icon size={16} />
      {message}
      {action && (
        <button type="button" className="agri-toast-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
