"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { canManageStaffAccounts } from "@/lib/permissions";
import type {
  CreateStaffUserInput,
  StaffCreatableRole,
  StaffUserRow,
  VaccinationReminder,
  OpdDashboardSummary,
} from "@/lib/types";

export default function DashboardPage() {
  const { state } = useAuth();
  const isSuperadmin =
    state.status === "user" && canManageStaffAccounts(state.user.role);
  const myId = state.status === "user" ? state.user.id : null;

  const [reminders, setReminders] = useState<VaccinationReminder[]>([]);
  const [staff, setStaff] = useState<StaffUserRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [staffErr, setStaffErr] = useState<string | null>(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const [opd, setOpd] = useState<OpdDashboardSummary | null>(null);
  const [userForm, setUserForm] = useState<CreateStaffUserInput>({
    username: "",
    password: "",
    display_name: "",
    role: "vet",
  });

  useEffect(() => {
    api
      .dashboardVaccinationReminders(30)
      .then(setReminders)
      .catch((e) => setErr(String(e)));
    api
      .opdDashboard()
      .then(setOpd)
      .catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!isSuperadmin) return;
    api
      .usersList()
      .then(setStaff)
      .catch((e) => setStaffErr(String(e)));
  }, [isSuperadmin]);

  async function reloadStaff() {
    if (!isSuperadmin) return;
    setStaffErr(null);
    try {
      setStaff(await api.usersList());
    } catch (e) {
      setStaffErr(String(e));
    }
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    if (!isSuperadmin) return;
    setStaffErr(null);
    setStaffBusy(true);
    try {
      await api.usersCreate({
        username: userForm.username.trim(),
        password: userForm.password,
        display_name: userForm.display_name.trim(),
        role: userForm.role,
      });
      setUserForm({
        username: "",
        password: "",
        display_name: "",
        role: "vet",
      });
      await reloadStaff();
    } catch (e) {
      setStaffErr(String(e));
    } finally {
      setStaffBusy(false);
    }
  }

  async function setUserActive(userId: string, active: boolean) {
    if (!isSuperadmin) return;
    setStaffErr(null);
    try {
      await api.usersSetActive(userId, active);
      await reloadStaff();
    } catch (e) {
      setStaffErr(String(e));
    }
  }

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <p className="muted">
        Vaccination reminders in the next 30 days (based on next due dates on pet
        profiles).
      </p>
      {err && <p className="error">{err}</p>}
      <div className="card">
        <h2>Upcoming vaccinations</h2>
        {reminders.length === 0 ? (
          <p className="muted">No reminders in this window.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Pet</th>
                <th>Vaccine</th>
                <th>Due</th>
                <th>Days</th>
              </tr>
            </thead>
            <tbody>
            {reminders.map((r, i) => (
              <tr key={`${r.pet_id}-${r.vaccine_name}-${i}`}>
                <td>
                  <Link href={`/pets/${r.pet_id}`}>{r.pet_name}</Link>
                </td>
                <td>{r.vaccine_name}</td>
                <td>{r.next_due_date}</td>
                <td>{r.days_until}</td>
              </tr>
            ))}
            </tbody>
            </table>
            )}
            </div>

            {opd && (
            <div className="card" style={{ marginTop: "1rem" }}>
            <h2>OPD activity</h2>
            <p className="muted">
            Checked today: <strong>{opd.checked_today}</strong> · Week:{" "}
            <strong>{opd.checked_week}</strong> · Month:{" "}
            <strong>{opd.checked_month}</strong>
            </p>
            <h3 className="small muted" style={{ marginTop: "0.75rem" }}>
            Next visits
            </h3>
            {opd.next_visits.length === 0 ? (
            <p className="muted">No upcoming visits scheduled.</p>
            ) : (
            <table className="table">
            <thead>
              <tr>
                <th>Pet</th>
                <th>Visit date</th>
                <th>Vet</th>
                <th>Dx</th>
              </tr>
            </thead>
            <tbody>
              {opd.next_visits.map((visit) => (
                <tr key={visit.id ?? `visit-${visit.pet_id}-${visit.next_visit_at}`}>
                  <td>
                    <Link href={`/pets/${visit.pet_id}`}>{visit.pet_name}</Link>
                  </td>
                  <td>{visit.next_visit_at ?? "—"}</td>
                  <td>{visit.vet_name}</td>
                  <td>{visit.diagnosis_note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
            </table>
            )}
            </div>
            )}

            {isSuperadmin && (
            <div className="card" style={{ marginTop: "1.5rem" }}>
            <h2>Staff accounts</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
            Superadmin only: create manager and veterinarian logins. They have the
            same clinic access; type is for labels. You cannot create another
            superadmin from here.
            </p>
            {staffErr && <p className="error">{staffErr}</p>}
            <form
            className="stack tight"
            onSubmit={(e) => void onCreateUser(e)}
            style={{ marginBottom: "1.25rem" }}
            >
            <div className="grid2">
            <label>
              Username *
              <input
                required
                autoComplete="off"
                value={userForm.username}
                onChange={(e) =>
                  setUserForm({ ...userForm, username: e.target.value })
                }
              />
            </label>
            <label>
              Display name *
              <input
                required
                value={userForm.display_name}
                onChange={(e) =>
                  setUserForm({ ...userForm, display_name: e.target.value })
                }
              />
            </label>
            </div>
            <div className="grid2">
            <label>
              Password * (min 8 characters)
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={userForm.password}
                onChange={(e) =>
                  setUserForm({ ...userForm, password: e.target.value })
                }
              />
            </label>
            <label>
              Account type *
              <select
                value={userForm.role}
                onChange={(e) =>
                  setUserForm({
                    ...userForm,
                    role: e.target.value as StaffCreatableRole,
                  })
                }
              >
                <option value="vet">Veterinarian</option>
                <option value="manager">Clinic manager</option>
              </select>
            </label>
            </div>
            <div className="row-actions">
            <button type="submit" className="btn primary" disabled={staffBusy}>
              {staffBusy ? "Saving…" : "Add user"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void reloadStaff()}
            >
              Refresh list
            </button>
            </div>
            </form>
            <h3 className="small muted" style={{ marginBottom: "0.5rem" }}>
            Current accounts
            </h3>
            {staff.length === 0 ? (
            <p className="muted">No users loaded.</p>
            ) : (
            <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Display name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Added</th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id ?? u.username}>
                  <td>{u.username}</td>
                  <td>{u.display_name}</td>
                  <td>
                    <span className="role-pill">{u.role}</span>
                  </td>
                  <td>
                    {u.active ? (
                      <span className="muted">Active</span>
                    ) : (
                      <span>Deactivated</span>
                    )}
                  </td>
                  <td className="muted small">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="right nowrap">
                    {u.active ? (
                      <button
                        type="button"
                        className="btn danger ghost small"
                        disabled={u.id === myId}
                        title={
                          u.id === myId
                            ? "You cannot deactivate your own account"
                            : undefined
                        }
                        onClick={() => void setUserActive(u.id, false)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => void setUserActive(u.id, true)}
                      >
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
            )}
            </div>
            )}
            </div>
  );
}
