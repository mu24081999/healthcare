import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Dog,
  Stethoscope,
  FlaskConical,
  ClipboardList,
  FileText,
  FileCheck,
  Microscope,
  Settings,
  Building2,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "./auth";
import { canManageClinic, canManageClinicConfiguration } from "./permissions";
import { Logo } from "./components/Logo";
import { useLiveNotice, useRefreshSync, useSyncStatus } from "./sync";
// import { useClinic } from "./components/ClinicProvider";

export default function Layout() {
  const { state, logout } = useAuth();
  const syncStatus = useSyncStatus();
  const refreshSync = useRefreshSync();
  const liveNotice = useLiveNotice();
  // const { clinic } = useClinic();
  const loc = useLocation();

  if (state.status === "loading") {
    return (
      <div className="auth-wrap">
        <p>Loading…</p>
      </div>
    );
  }

  if (state.status === "guest") {
    return <Navigate to="/login" state={{ from: loc }} replace />;
  }

  const { user } = state;
  const showLabCatalog = canManageClinic(user.role);
  const showClinicAdmin = canManageClinicConfiguration(user.role);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            // gap: "0.75rem",
            marginBottom: "2rem",
            flexDirection: "column",
          }}
        >
          <Logo style={{ width: '12rem', height: '4rem', fontSize: '1.5rem', marginBottom: 0 }} />

          {/* <div className="brand" style={{ margin: 0, display: "block" }}>
            {clinic?.name || "Waleed Pet Care Clinic"}
          </div> */}
        </div>
        <nav className="nav">
          <Link className={loc.pathname === "/" ? "active" : ""} to="/">
            <LayoutDashboard size={18} /> Dashboard
          </Link>
          <Link
            className={loc.pathname.startsWith("/pets") ? "active" : ""}
            to="/pets"
          >
            <Dog size={18} /> Pets
          </Link>
          <Link
            className={
              loc.pathname.startsWith("/hospitalization") ? "active" : ""
            }
            to="/hospitalization"
          >
            <Stethoscope size={18} /> Hospitalization
          </Link>
          {showClinicAdmin && (
            <Link
              className={loc.pathname === "/clinic" ? "active" : ""}
              to="/clinic"
            >
              <Building2 size={18} /> Clinic Information
            </Link>
          )}

          <div
            style={{
              marginTop: "1.5rem",
              marginBottom: "0.25rem",
              paddingLeft: "0.75rem",
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#888888",
              fontWeight: 600,
            }}
          >
            OPD
          </div>
          <Link
            className={loc.pathname.startsWith("/opd") ? "active" : ""}
            to="/opd"
          >
            <ClipboardList size={18} /> OPD requests
          </Link>
          {showClinicAdmin && (
            <Link
              className={
                loc.pathname.startsWith("/opd-settings") ? "active" : ""
              }
              to="/opd-settings"
            >
              <Settings size={18} /> OPD settings
            </Link>
          )}

          <div
            style={{
              marginTop: "1.5rem",
              marginBottom: "0.25rem",
              paddingLeft: "0.75rem",
              fontSize: "0.75rem",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "#888888",
              fontWeight: 600,
            }}
          >
            Laboratory
          </div>
          <Link
            className={loc.pathname.startsWith("/lab") ? "active" : ""}
            to="/lab"
          >
            <FlaskConical size={18} /> Laboratory
          </Link>
          <Link
            className={loc.pathname === "/reports" ? "active" : ""}
            to="/reports"
          >
            <FileText size={18} /> Generate report
          </Link>
          <Link
            className={loc.pathname === "/reports/generated" ? "active" : ""}
            to="/reports/generated"
          >
            <FileCheck size={18} /> Generated reports
          </Link>
          {showLabCatalog && (
            <Link
              className={
                loc.pathname.startsWith("/lab-catalog") ? "active" : ""
              }
              to="/lab-catalog"
            >
              <Microscope size={18} /> Lab catalog
            </Link>
          )}
        </nav>
        <div
          className="sidebar-foot"
          style={{
            padding: "1rem",
            background: "rgba(255,255,255,0.05)",
            borderRadius: "8px",
          }}
        >
          <div
            className="small"
            style={{
              color:
                syncStatus === "online"
                  ? "#eeeeee"
                  : syncStatus === "offline"
                    ? "#888888"
                    : "#a1a1a1",
              marginBottom: "0.75rem",
              fontWeight: 600,
            }}
          >
            {syncStatus === "online"
              ? "Synced · live updates on"
              : syncStatus === "offline"
                ? "Offline · saving locally"
                : "Syncing…"}
          </div>
          {liveNotice ? (
            <div
              className="sidebar-live-notice no-print"
              role="status"
              aria-live="polite"
            >
              {liveNotice}
            </div>
          ) : null}
          <button
            type="button"
            className="btn ghost small"
            disabled={syncStatus === "syncing"}
            onClick={() => refreshSync()}
            title="Upload local changes and download latest from the cloud"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
              marginBottom: "0.75rem",
              opacity: syncStatus === "syncing" ? 0.7 : 1,
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation:
                  syncStatus === "syncing" ? "spin 1s linear infinite" : undefined,
              }}
            />
            {syncStatus === "syncing" ? "Refreshing…" : "Refresh sync"}
          </button>
          <div className="small" style={{ color: "#fff", fontWeight: 600 }}>
            {user.display_name}
          </div>
          <div
            className="small"
            style={{ color: "#a1a1a1", marginBottom: "0.75rem" }}
          >
            <span className="role-pill">{user.role}</span>
          </div>
          <button
            type="button"
            className="btn ghost small"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              background: "rgba(255, 255, 255, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              color: "#fff",
              marginTop: "0.5rem",
            }}
            onClick={() => logout()}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
