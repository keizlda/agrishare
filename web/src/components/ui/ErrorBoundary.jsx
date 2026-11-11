import { Component } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

// If a page throws while rendering, show a plain "Something went wrong"
// card with Reload instead of a white screen. The error is logged for
// whoever's debugging. Give it key={location.pathname} around a page, so
// navigating away from a broken page starts fresh.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="agri-crash" role="alert">
        <div className="agri-card agri-crash-card">
          <div className="agri-crash-icon">
            <AlertTriangle size={22} />
          </div>
          <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: 6 }}>Something went wrong</div>
          <div className="agri-muted" style={{ fontSize: "0.85rem", marginBottom: 18 }}>
            This page couldn't be shown. Reload to try again — if it keeps happening, let the system administrator know.
          </div>
          <button type="button" className="btn btn-agri-primary d-inline-flex align-items-center gap-2" onClick={() => window.location.reload()}>
            <RotateCw size={15} /> Reload
          </button>
        </div>
      </div>
    );
  }
}
