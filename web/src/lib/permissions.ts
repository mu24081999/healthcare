import type { Role } from "@/lib/types";

/** Superadmin, managers, and vets can use all clinic features (pets, lab, etc.). */
export function canManageClinic(role: Role): boolean {
  return role === "superadmin" || role === "manager" || role === "vet";
}

/** Clinic profile, OPD catalog defaults — superadmin only (not shown to vet/manager). */
export function canManageClinicConfiguration(role: Role): boolean {
  return role === "superadmin";
}

export function assertCanManageClinic(role: Role): void {
  if (!canManageClinic(role)) {
    throw new Error("Forbidden");
  }
}

/** Only superadmin may list or create staff users. */
export function canManageStaffAccounts(role: Role): boolean {
  return role === "superadmin";
}

export function assertSuperadmin(role: Role): void {
  if (!canManageStaffAccounts(role)) {
    throw new Error("Forbidden");
  }
}
