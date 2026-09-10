/**
 * superadmin: full clinic access + can create manager/vet accounts.
 * manager / vet: full clinic access; cannot manage user accounts.
 */
export type Role = "superadmin" | "manager" | "vet";

/** Roles that superadmin may create via Staff accounts (not another superadmin). */
export type StaffCreatableRole = "manager" | "vet";

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  role: Role;
}

/** Staff directory row (no password fields). */
export interface StaffUserRow {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  created_at: string;
  active: boolean;
}

export interface CreateStaffUserInput {
  username: string;
  password: string;
  display_name: string;
  role: StaffCreatableRole;
}

export interface PetRow {
  id: string;
  card_id: string;
  name: string;
  species: string | null;
  breed: string | null;
  age: string | null;
  date_of_birth: string | null;
  sex: string | null;
  weight: string | null;
  vaccine_status: string | null;
  deworming_status: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_address: string | null;
  owner_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PetListRow extends PetRow {
  medical_count: number;
  grooming_count: number;
}

export interface PetInput {
  name: string;
  species?: string | null;
  breed?: string | null;
  age?: string | null;
  date_of_birth?: string | null;
  sex?: string | null;
  weight?: string | null;
  vaccine_status?: string | null;
  deworming_status?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  owner_address?: string | null;
  owner_email?: string | null;
  notes?: string | null;
}

export interface MedicalRow {
  id: string;
  pet_id: string;
  entry_type: string;
  title: string | null;
  body: string | null;
  dx_items?: string[];
  ddx_items?: string[];
  dx_note?: string | null;
  ddx_note?: string | null;
  administered_date: string | null;
  next_due_date: string | null;
  reminder_days_before: number | null;
  external_file_path: string | null;
  external_file_paths?: string[];
  lab_result_id: string | null;
  created_at: string;
  body_weight: string | null;
}

export interface MedicalInput {
  entry_type: string;
  title?: string | null;
  body?: string | null;
  dx_items?: string[];
  ddx_items?: string[];
  dx_note?: string | null;
  ddx_note?: string | null;
  administered_date?: string | null;
  next_due_date?: string | null;
  reminder_days_before?: number | null;
  external_file_path?: string | null;
  external_file_paths?: string[];
  body_weight?: string | null;
}

export interface VaccinationRow {
  id: string;
  pet_id: string;
  vaccine_name: string;
  administered_date: string | null;
  next_due_date: string | null;
  reminder_days_before: number | null;
  notes: string | null;
  created_at: string;
  body_weight: string | null;
}

export interface VaccinationInput {
  vaccine_name: string;
  administered_date?: string | null;
  next_due_date?: string | null;
  reminder_days_before?: number | null;
  notes?: string | null;
  body_weight?: string | null;
}

export interface HospitalizationRow {
  id: string;
  pet_id: string;
  cage_number: string;
  check_in_date: string;
  check_out_date: string | null;
  created_at: string;
}

export interface HospitalizationInput {
  pet_id: string;
  cage_number: string;
  check_in_date: string;
  check_out_date?: string | null;
}

export interface GroomingRow {
  id: string;
  pet_id: string;
  service_type: string;
  administered_date: string | null;
  next_due_date: string | null;
  reminder_days_before: number | null;
  performed_date: string;
  notes: string | null;
  created_at: string;
  body_weight: string | null;
}

export interface GroomingInput {
  service_type: string;
  administered_date?: string | null;
  next_due_date?: string | null;
  reminder_days_before?: number | null;
  performed_date: string;
  notes?: string | null;
  body_weight?: string | null;
}

export interface LabTestRow {
  id: string;
  name: string;
  code: string | null;
  default_report_hours: number | null;
  active: number;
  created_at: string;
}

export interface LabTestInput {
  name: string;
  code?: string | null;
  default_report_hours?: number | null;
}

export interface AnalyteRow {
  id: string;
  lab_test_id: string;
  name: string;
  unit: string | null;
  normal_min: number | null;
  normal_max: number | null;
  sort_order: number;
  remarks: string | null;
}

export interface AnalyteInput {
  name: string;
  unit?: string | null;
  normal_min?: number | null;
  normal_max?: number | null;
  sort_order?: number | null;
  remarks?: string | null;
}

export interface LabOrderRow {
  id: string;
  pet_id: string;
  lab_test_id: string;
  receipt_number: string | null;
  tentative_report_at: string | null;
  status: string;
  created_at: string;
  lab_result_id: string | null;
}

export interface LabOrderInput {
  pet_id: string;
  lab_test_id: string;
  tentative_report_at?: string | null;
}

export interface LabResultValueInput {
  analyte_id: string;
  observed_value: string;
}

export interface LabResultValuePatch {
  id: string;
  observedValue: string;
}

export interface LabResultValueRow {
  id: string;
  analyte_name: string;
  unit: string | null;
  normal_min: number | null;
  normal_max: number | null;
  observed_value: string;
  remarks: string | null;
}

export interface LabResultDetail {
  id: string;
  lab_order_id: string;
  pet_id: string;
  lab_test_id: string;
  created_at: string;
  notes: string | null;
  values: LabResultValueRow[];
}

export interface LabResultSummaryRow {
  id: string;
  pet_id: string;
  pet_name: string;
  lab_test_id: string;
  test_name: string;
  created_at: string;
  notes: string | null;
}

export interface VaccinationReminder {
  pet_id: string;
  pet_name: string;
  vaccine_name: string;
  next_due_date: string;
  days_until: number;
}

export type OpdRequestStatus = "pending" | "in_progress" | "completed";

export interface OpdRequestRow {
  id: string;
  pet_id: string;
  pet_name: string;
  pet_card_id: string;
  species: string | null;
  breed: string | null;
  weight: string | null;
  age: string | null;
  date_of_birth: string | null;
  sex: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  requested_by_user_id: string;
  requested_by_name: string;
  status: OpdRequestStatus;
  assigned_vet_id: string | null;
  assigned_vet_name: string | null;
  created_at: string;
  claimed_at: string | null;
  completed_at: string | null;
}

export interface OpdMedicineInput {
  name: string;
  dosage?: string | null;
  direction_per_day?: string | null;
}

export interface OpdMedicineRow {
  name: string;
  dosage: string | null;
  direction_per_day: string | null;
}

export interface OpdConsultationInput {
  request_id: string;
  temperature?: string | null;
  body_weight?: string | null;
  physical_exam?: string | null;
  history_observations?: string[];
  dx_items?: string[];
  ddx_items?: string[];
  diagnosis_note?: string | null;
  differential_diagnosis_note?: string | null;
  symptoms?: string[];
  recommended_lab_test_ids?: string[];
  custom_lab_tests?: string[];
  medicines?: OpdMedicineInput[];
  clinical_treatment_remark?: string | null;
  in_house_prescription?: string | null;
  recommended_food?: string | null;
  next_visit_at?: string | null;
  doctor_signature_name: string;
}

export interface OpdConsultationRow {
  id: string;
  request_id: string;
  pet_id: string;
  pet_name: string;
  pet_card_id: string;
  species: string | null;
  breed: string | null;
  weight: string | null;
  age: string | null;
  date_of_birth: string | null;
  sex: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  vet_id: string;
  vet_name: string;
  doctor_signature_name: string;
  temperature: string | null;
  physical_exam: string | null;
  history_observations: string[];
  dx_items: string[];
  ddx_items: string[];
  diagnosis_note: string | null;
  differential_diagnosis_note: string | null;
  symptoms: string[];
  recommended_lab_test_ids: string[];
  recommended_lab_test_names: string[];
  custom_lab_tests: string[];
  medicines: OpdMedicineRow[];
  clinical_treatment_remark: string | null;
  in_house_prescription: string | null;
  recommended_food: string | null;
  next_visit_at: string | null;
  created_at: string;
  body_weight: string | null;
}

export type OpdCatalogType =
  | "history_observation"
  | "dx"
  | "ddx"
  | "vaccine"
  | "deworming"
  | "surgery"
  | "surgery_dx"
  | "surgery_ddx"
  | "radiology_dx"
  | "radiology_ddx"
  | "ultrasonography_dx"
  | "ultrasonography_ddx"
  | "medicine"
  | "food"
  | "symptom";

export interface OpdCatalogItemRow {
  id: string;
  type: OpdCatalogType;
  name: string;
  active: boolean;
  created_at: string;
}

export interface ClinicRow {
  id: string;
  name: string;
  email: string;
  address: string;
  phone: string;
  timing: string;
  created_at: string;
  updated_at: string;
  logo?: string | null;
}

export interface ClinicInput {
  name: string;
  email: string;
  address: string;
  phone: string;
  timing: string;
  logo?: string | null;
}

export interface OpdDashboardSummary {
  checked_today: number;
  checked_week: number;
  checked_month: number;
  next_visits: OpdConsultationRow[];
}

export function valueHighlight(
  v: number | string,
  min: number | null,
  max: number | null,
): "low" | "high" | "ok" {
  const num = typeof v === "number" ? v : parseFloat(v);
  if (isNaN(num)) return "ok";
  if (min != null && num < min) return "low";
  if (max != null && num > max) return "high";
  return "ok";
}
