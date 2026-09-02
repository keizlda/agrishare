import { useEffect } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

export default function Toast({ message, tone = "success", onDone }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  const Icon = tone === "error" ? XCircle : CheckCircle2;

  return (
    <div className={`agri-toast ${tone}`}>
      <Icon size={16} />
      {message}
    </div>
  );
}
