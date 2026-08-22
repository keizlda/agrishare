import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, Mail, Sprout, User } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import loginBg from "../assets/login-bg.jpg";
import daSeal from "../assets/da-seal.png";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const emailRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message === "Invalid login credentials" ? "Incorrect email or password." : err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="agri-login-page">
      <img src={loginBg} alt="" className="agri-login-bg" />

      {/* Top nav */}
      <nav className="agri-login-nav">
        <div className="agri-login-logo">
          <Sprout size={22} />
          <span>AGRI<em>SHARE</em></span>
        </div>
      </nav>

      {/* DA seal */}
      <div className="agri-login-seal">
        <div className="agri-login-seal-badge">
          <img src={daSeal} alt="Department of Agriculture" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
        </div>
        <div>
          <div style={{ fontWeight: 700 }}>Department of Agriculture</div>
          <div style={{ opacity: 0.85 }}>Municipality of Labangan</div>
        </div>
      </div>

      {/* Login card */}
      <div className="agri-login-card-wrap">
        <div className="agri-login-card">
          <div className="agri-login-icon">
            <User size={26} />
          </div>
          <h2 style={{ fontWeight: 700, marginBottom: 4, color: "var(--agri-primary-darker)" }}>Welcome Back!</h2>
          <p className="agri-muted" style={{ fontSize: "0.85rem", marginBottom: 18 }}>
            Login to your AgriShare account
          </p>

          <form onSubmit={handleSubmit} style={{ textAlign: "left" }}>
            {error && (
              <div className="agri-pill red" style={{ display: "block", marginBottom: 14, padding: "8px 12px" }}>
                {error}
              </div>
            )}

            <div style={{ position: "relative", marginBottom: 14 }}>
              <Mail size={16} style={{ position: "absolute", left: 12, top: 12, color: "#8b978f" }} />
              <input
                ref={emailRef}
                id="email"
                type="email"
                className="form-control"
                placeholder="Enter your email"
                style={{ paddingLeft: 36 }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div style={{ position: "relative", marginBottom: 22 }}>
              <Lock size={16} style={{ position: "absolute", left: 12, top: 12, color: "#8b978f" }} />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                className="form-control"
                placeholder="Enter your password"
                style={{ paddingLeft: 36, paddingRight: 36 }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                style={{ position: "absolute", right: 10, top: 9, background: "none", border: "none", color: "#8b978f" }}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <button type="submit" className="btn btn-agri-primary w-100" style={{ padding: "10px 0", fontWeight: 600 }} disabled={submitting}>
              {submitting ? "Signing in…" : "Login"}
            </button>
          </form>

          <p className="agri-muted" style={{ fontSize: "0.72rem", marginTop: 20 }}>
            For MAO Admin and FA President use only. Registered farmers should use the AgriShare mobile app.
          </p>
        </div>
      </div>
    </div>
  );
}
