"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, Dog, Stethoscope, FlaskConical, ClipboardList, FileText, 
  FileCheck, Microscope, Settings, Building2, LogOut 
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { canManageClinic, canManageClinicConfiguration } from "@/lib/permissions";
import { Logo } from "@/components/logo";
import { useClinic } from "@/components/clinic-provider";

export function Shell({ children }: { children: React.ReactNode }) {
  const { state, logout } = useAuth();
  const { clinic } = useClinic();
  const pathname = usePathname();

  if (state.status === "loading") {
    return (
      <div className="auth-wrap">
        <p>Loading…</p>
      </div>
    );
  }

  if (state.status === "guest") {
    return <div className="auth-wrap">{children}</div>;
  }

  const { user } = state;
  const showLabCatalog = canManageClinic(user.role);
  const showClinicAdmin = canManageClinicConfiguration(user.role);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem' }}>
          <Logo variation="light" style={{ width: '12rem', height: '4rem', fontSize: '1.5rem', marginBottom: 0 }} />
          {/* <div className="brand" style={{ margin: 0 }}>{clinic?.name || 'Health Care'}</div> */}
        </div>
        <nav className="nav">
          <Link className={pathname === "/" ? "active" : ""} href="/">
            <LayoutDashboard size={18} /> Dashboard
          </Link>
          <Link
            className={pathname.startsWith("/pets") ? "active" : ""}
            href="/pets"
          >
            <Dog size={18} /> Pets
          </Link>
          <Link
            className={pathname.startsWith("/hospitalization") ? "active" : ""}
            href="/hospitalization"
          >
            <Stethoscope size={18} /> Hospitalization
          </Link>
          {showClinicAdmin && (
            <Link
              className={pathname === "/clinic" ? "active" : ""}
              href="/clinic"
            >
              <Building2 size={18} /> Clinic Information
            </Link>
          )}

          <div style={{ marginTop: '1.5rem', marginBottom: '0.25rem', paddingLeft: '0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888888', fontWeight: 600 }}>OPD</div>
          <Link
            className={pathname.startsWith("/opd") ? "active" : ""}
            href="/opd"
          >
            <ClipboardList size={18} /> OPD requests
          </Link>
          {showClinicAdmin && (
            <Link
              className={pathname.startsWith("/opd-settings") ? "active" : ""}
              href="/opd-settings"
            >
              <Settings size={18} /> OPD settings
            </Link>
          )}

          <div style={{ marginTop: '1.5rem', marginBottom: '0.25rem', paddingLeft: '0.75rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888888', fontWeight: 600 }}>Laboratory</div>
          <Link
            className={pathname.startsWith("/lab") ? "active" : ""}
            href="/lab"
          >
            <FlaskConical size={18} /> Laboratory
          </Link>
          <Link
            className={pathname === "/reports" ? "active" : ""}
            href="/reports"
          >
            <FileText size={18} /> Generate report
          </Link>
          <Link
            className={pathname === "/reports/generated" ? "active" : ""}
            href="/reports/generated"
          >
            <FileCheck size={18} /> Generated reports
          </Link>
          {showLabCatalog && (
            <Link
              className={pathname.startsWith("/lab-catalog") ? "active" : ""}
              href="/lab-catalog"
            >
              <Microscope size={18} /> Lab catalog
            </Link>
          )}
        </nav>
        <div className="sidebar-foot" style={{ padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
          <div className="small" style={{ color: '#fff', fontWeight: 600 }}>
            {user.display_name}
          </div>
          <div className="small" style={{ color: '#a1a1a1', marginBottom: '0.75rem' }}>
            <span className="role-pill">{user.role}</span>
          </div>
          <button
            type="button"
            className="btn ghost small"
            style={{ 
              width: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              gap: '0.5rem', 
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              marginTop: '0.5rem'
            }}
            onClick={() => void logout()}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
