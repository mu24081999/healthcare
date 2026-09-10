"use client";

import { FormEvent, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, User, Lock } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useClinic } from "@/components/clinic-provider";
import { Logo } from "@/components/logo";

export default function LoginPage() {
  const { state, login } = useAuth();
  const { clinic } = useClinic();
  const router = useRouter();
  const [username, setUsername] = useState("superadmin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.status === "user") {
      router.replace("/");
    }
  }, [state.status, router]);

  if (state.status === "loading" || state.status === "user") {
    return (
      <div className="auth-wrap">
        <p>Loading…</p>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(username, password);
      router.replace("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div className="auth-form-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <Logo style={{ width: '4rem', height: '4rem', marginBottom: '0.5rem' }} />
          <h1>{clinic?.name || 'Pet Care Clinic'}</h1>
          <p className="subtitle">Sign in to continue to your account</p>
        </div>
        <div className="auth-form-group">
          <label className="auth-form-label">
            Username
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#5c6473' }} />
              <input
                className="auth-form-input"
                style={{ width: '100%', paddingLeft: '2.2rem' }}
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </label>
          <label className="auth-form-label">
            Password
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#5c6473' }} />
              <input
                className="auth-form-input"
                style={{ width: '100%', paddingLeft: '2.2rem', paddingRight: '2.5rem' }}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#5c6473'
                }}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
        </div>
        {err && <p className="error">{err}</p>}
        <button type="submit" className="btn primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="hint muted" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
          Need help? Contact your administrator.
        </p>
      </form>
    </div>
  );
}
