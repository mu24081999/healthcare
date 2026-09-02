import { invoke } from "@tauri-apps/api/core";

async function invokeMut<T>(cmd: string, args?: any): Promise<T> {
  const res = await invoke<T>(cmd, args);
  invoke("sync_db").catch((e) => console.error("Sync error:", e));
  return res;
}

/**
 * superadmin: full clinic access + user management (desktop).
 * manager / vet: full clinic access.
 */
export type Role = "superadmin" | "manager" | "vet";

export type StaffCreatableRole = "manager" | "vet";

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  role: Role;
}

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

/** Returned by `petsList` — includes history counts for the table view. */
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

export const api = {
  authLogin: (username: string, password: string) =>
    invoke<SessionUser>("auth_login", { input: { username, password } }),
  authLogout: () => invoke<void>("auth_logout"),
  authSession: () => invoke<SessionUser | null>("auth_session"),

  petsList: (query?: string) => invoke<PetListRow[]>("pets_list", { query }),
  petsGet: (id: string) => invoke<PetRow>("pets_get", { id }),
  petsCreate: (input: PetInput) => invokeMut<PetRow>("pets_create", { input }),
  petsUpdate: (id: string, input: PetInput) =>
    invokeMut<PetRow>("pets_update", { id, input }),
  petsDelete: (id: string) => invokeMut<void>("pets_delete", { id }),

  medicalList: (petId: string) =>
    invoke<MedicalRow[]>("medical_list", { petId }),
  medicalAdd: (petId: string, input: MedicalInput) =>
    invokeMut<MedicalRow>("medical_add", { petId, input }),
  medicalUpdate: (petId: string, entryId: string, input: MedicalInput) =>
    invokeMut<MedicalRow>("medical_update", { petId, entryId, input }),
  medicalDelete: (petId: string, entryId: string) =>
    invokeMut<void>("medical_delete", { petId, entryId }),

  vaccinationsList: (petId: string) =>
    invoke<VaccinationRow[]>("vaccinations_list", { petId }),
  vaccinationsUpsert: (
    petId: string,
    input: VaccinationInput,
    id?: string | null
  ) =>
    invokeMut<VaccinationRow>("vaccinations_upsert", {
      petId,
      id: id ?? null,
      input,
    }),
  vaccinationsDelete: (petId: string, vaccinationId: string) =>
    invokeMut<void>("vaccinations_delete", { petId, vaccinationId }),

  hospitalizationsList: () => invoke<HospitalizationRow[]>("hospitalizations_list"),
  hospitalizationsUpsert: (input: HospitalizationInput, id?: string | null) =>
    invokeMut<HospitalizationRow>("hospitalizations_upsert", { input, id: id ?? null }),
  hospitalizationsDelete: (id: string) =>
    invokeMut<void>("hospitalizations_delete", { id }),
  clinicGet: () => invoke<ClinicRow>("clinic_get"),
  clinicUpdate: (input: ClinicInput) => invokeMut<ClinicRow>("clinic_update", { input }),

  groomingList: (petId: string) =>
    invoke<GroomingRow[]>("grooming_list", { petId }),
  groomingAdd: (petId: string, input: GroomingInput) =>
    invokeMut<GroomingRow>("grooming_add", { petId, input }),
  groomingUpdate: (petId: string, groomingId: string, input: GroomingInput) =>
    invokeMut<GroomingRow>("grooming_update", { petId, groomingId, input }),
  groomingDelete: (petId: string, groomingId: string) =>
    invokeMut<void>("grooming_delete", { petId, groomingId }),

  labTestsList: () => invoke<LabTestRow[]>("lab_tests_list"),
  labTestsListAll: () => invoke<LabTestRow[]>("lab_tests_list_all"),
  labTestCreate: (input: LabTestInput) =>
    invokeMut<LabTestRow>("lab_test_create", { input }),
  labTestUpdate: (id: string, input: LabTestInput) =>
    invokeMut<LabTestRow>("lab_test_update", { id, input }),
  labTestDelete: (id: string) => invokeMut<void>("lab_test_delete", { id }),

  labAnalytesList: (labTestId: string) =>
    invoke<AnalyteRow[]>("lab_analytes_list", { labTestId }),
  labAnalyteUpsert: (
    labTestId: string,
    input: AnalyteInput,
    id?: string | null
  ) =>
    invokeMut<AnalyteRow>("lab_analyte_upsert", {
      labTestId,
      id: id ?? null,
      input,
    }),
  labAnalyteDelete: (id: string) =>
    invokeMut<void>("lab_analyte_delete", { id }),

  labOrderCreate: (input: LabOrderInput) =>
    invokeMut<LabOrderRow>("lab_order_create", { input }),
  labOrdersForPet: (petId: string) =>
    invoke<LabOrderRow[]>("lab_orders_for_pet", { petId }),
  labOrderDelete: (orderId: string) =>
    invokeMut<void>("lab_order_delete", { orderId }),

  labResultSave: (
    labOrderId: string,
    values: LabResultValueInput[],
    notes?: string | null
  ) =>
    invokeMut<LabResultDetail>("lab_result_save", {
      labOrderId,
      values,
      notes: notes ?? null,
    }),
  labResultGet: (id: string) =>
    invoke<LabResultDetail>("lab_result_get", { id }),
  labResultsHistory: () => invoke<LabResultSummaryRow[]>("lab_results_history"),
  labResultsForHistory: (petId: string, labTestId: string) =>
    invoke<LabResultDetail[]>("lab_results_for_history", { petId, labTestId }),
  labResultUpdate: (

    labResultId: string,
    values: LabResultValuePatch[],
    notes?: string | null
  ) =>
    invokeMut<LabResultDetail>("lab_result_update", {
      labResultId,
      values,
      notes: notes ?? null,
    }),

  dashboardVaccinationReminders: (withinDays: number) =>
    invoke<VaccinationReminder[]>("dashboard_vaccination_reminders", {
      withinDays,
    }),

  opdRequestsList: (status?: OpdRequestFilter) =>
    invoke<OpdRequestRow[]>("opd_requests_list", { status }),
  opdRequestCreate: (petId: string) =>
    invokeMut<OpdRequestRow>("opd_request_create", { petId }),
  opdRequestClaim: (id: string) =>
    invokeMut<OpdRequestRow>("opd_request_claim", { id }),
  opdRequestDelete: (id: string) =>
    invokeMut<void>("opd_request_delete", { id }),
  opdConsultationsList: (petId?: string, mine?: boolean) =>
    invoke<OpdConsultationRow[]>("opd_consultations_list", { petId, mine }),
  opdConsultationCreate: (input: OpdConsultationInput) =>
    invokeMut<OpdConsultationRow>("opd_consultation_create", { input }),
  opdConsultationUpdate: (id: string, input: OpdConsultationInput) =>
    invokeMut<OpdConsultationRow>("opd_consultation_update", { id, input }),
  opdConsultationDelete: (id: string) =>
    invokeMut<void>("opd_consultation_delete", { id }),
  opdRequestReopen: (id: string) =>
    invokeMut<OpdRequestRow>("opd_request_reopen", { id }),
  opdDashboardSummary: () =>
    invoke<OpdDashboardSummary>("opd_dashboard_summary"),
  /** Same as `opdDashboardSummary` — matches web `api.opdDashboard` name. */
  opdDashboard: () => invoke<OpdDashboardSummary>("opd_dashboard_summary"),
  opdCatalogList: (itemType?: OpdCatalogType) =>
    invoke<OpdCatalogItemRow[]>("opd_catalog_list", { itemType }),
  opdCatalogCreate: (itemType: OpdCatalogType, name: string) =>
    invokeMut<OpdCatalogItemRow>("opd_catalog_create", { itemType, name }),
  opdCatalogDelete: (id: string) => invokeMut<void>("opd_catalog_delete", { id }),
  opdCatalogRename: (id: string, name: string) =>
    invokeMut<OpdCatalogItemRow>("opd_catalog_rename", { id, name }),

  usersList: () => invoke<StaffUserRow[]>("users_list"),
  usersCreate: (input: CreateStaffUserInput) =>
    invokeMut<StaffUserRow>("users_create", { input }),
  usersSetActive: (userId: string, active: boolean) =>
    invokeMut<StaffUserRow>("users_set_active", { userId, active }),
};

export interface MedicalRow {
  id: string;
  pet_id: string;
  entry_type: string;
  title: string | null;
  body: string | null;
  body_weight: string | null;
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
}

export interface MedicalInput {
  entry_type: string;
  title?: string | null;
  body?: string | null;
  body_weight?: string | null;
  dx_items?: string[];
  ddx_items?: string[];
  dx_note?: string | null;
  ddx_note?: string | null;
  administered_date?: string | null;
  next_due_date?: string | null;
  reminder_days_before?: number | null;
  external_file_path?: string | null;
  external_file_paths?: string[];
}

export interface VaccinationRow {
  id: string;
  pet_id: string;
  vaccine_name: string;
  body_weight: string | null;
  administered_date: string | null;
  next_due_date: string | null;
  reminder_days_before: number | null;
  notes: string | null;
  created_at: string;
}

export interface VaccinationInput {
  vaccine_name: string;
  body_weight?: string | null;
  administered_date?: string | null;
  next_due_date?: string | null;
  reminder_days_before?: number | null;
  notes?: string | null;
}

export interface GroomingRow {
  id: string;
  pet_id: string;
  service_type: string;
  body_weight: string | null;
  performed_date: string;
  administered_date: string | null;
  next_due_date: string | null;
  reminder_days_before: number | null;
  notes: string | null;
  created_at: string;
}

export interface GroomingInput {
  service_type: string;
  body_weight?: string | null;
  administered_date?: string | null;
  next_due_date?: string | null;
  reminder_days_before?: number | null;
  performed_date: string;
  notes?: string | null;
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

/** Patches for `labResultUpdate` — uses existing value row ids from `labResultGet`. */
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

/** Row from `labResultsHistory` (all generated lab reports). */
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
export type OpdRequestFilter = "open" | OpdRequestStatus;

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
  vaccinated?: boolean;
  deworming?: boolean;
  prognosis?: string | null;
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
  vaccinated: boolean;
  deworming: boolean;
  prognosis: string | null;
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

export interface OpdDashboardSummary {
  checked_today: number;
  checked_week: number;
  checked_month: number;
  next_visits: OpdConsultationRow[];
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

export function valueHighlight(
  v: number | string,
  min: number | null,
  max: number | null
): "low" | "high" | "ok" {
  const num = typeof v === "number" ? v : parseFloat(v);
  if (isNaN(num)) return "ok";
  if (min != null && num < min) return "low";
  if (max != null && num > max) return "high";
  return "ok";
}
