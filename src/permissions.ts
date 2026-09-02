import type { Role } from "./api";

export function canManageStaffAccounts(role: Role): boolean {
  return role === "superadmin";
}

/** Superadmin, managers, and vets can use all clinic features (pets, lab, etc.). */
export function canManageClinic(role: Role): boolean {
  return role === "superadmin" || role === "manager" || role === "vet";
}

/** Clinic profile, OPD catalog defaults — superadmin only (not shown to vet/manager). */
export function canManageClinicConfiguration(role: Role): boolean {
  return role === "superadmin";
}
