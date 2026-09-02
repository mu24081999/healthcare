import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Eye, EyeOff, User, Lock } from "lucide-react";
import { useAuth } from "../auth";
import { Logo } from "../components/Logo";
// import { useClinic } from "../components/ClinicProvider";

export default function Login() {
  const { state, login } = useAuth();
  // const { clinic } = useClinic();
  const [username, setUsername] = useState("superadmin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (state.status === "loading") {
    return (
      <div className="auth-wrap">
        <p>Loading…</p>
      </div>
    );
  }

  if (state.status === "user") {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div
          className="auth-form-header"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <Logo style={{ width: "7rem", height: "7rem" }} />
          {/* <h1>{clinic?.name || "Waleed Pet Care Clinic"}</h1> */}
          <p className="subtitle">Sign in to continue to your account</p>
        </div>
        <div className="auth-form-group">
          <label className="auth-form-label">
            Username
            <div style={{ position: "relative" }}>
              <User
                size={18}
                style={{
                  position: "absolute",
                  left: "0.6rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#5c6473",
                }}
              />
              <input
                className="auth-form-input"
                style={{ width: "100%", paddingLeft: "2.2rem" }}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </label>
          <label className="auth-form-label">
            Password
            <div style={{ position: "relative" }}>
              <Lock
                size={18}
                style={{
                  position: "absolute",
                  left: "0.6rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#5c6473",
                }}
              />
              <input
                className="auth-form-input"
                style={{
                  width: "100%",
                  paddingLeft: "2.2rem",
                  paddingRight: "2.5rem",
                }}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                style={{
                  position: "absolute",
                  right: "0.5rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "0.25rem",
                  display: "flex",
                  alignItems: "center",
                  color: "#5c6473",
                }}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
        </div>
        {err && <p className="error">{err}</p>}
        <button
          type="submit"
          className="btn primary"
          style={{ width: "100%" }}
          disabled={busy}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p
          className="hint muted"
          style={{ textAlign: "center", marginTop: "1.5rem" }}
        >
          Need help? Contact your administrator.
        </p>
      </form>
    </div>
  );
}
