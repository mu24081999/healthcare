import mongoose, { Schema } from "mongoose";

const UserSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    display_name: { type: String, required: true },
    role: {
      type: String,
      required: true,
      enum: ["superadmin", "manager", "vet"],
    },
    created_at: { type: String, required: true },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: "users" },
);

const PetSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    card_id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    species: { type: String, default: null },
    breed: { type: String, default: null },
    age: { type: String, default: null },
    date_of_birth: { type: String, default: null },
    sex: { type: String, default: null },
    weight: { type: String, default: null },
    vaccine_status: { type: String, default: null },
    deworming_status: { type: String, default: null },
    owner_name: { type: String, default: null },
    owner_phone: { type: String, default: null },
    owner_address: { type: String, default: null },
    owner_email: { type: String, default: null },
    notes: { type: String, default: null },
    created_at: { type: String, required: true },
    updated_at: { type: String, required: true },
  },
  { collection: "pets" },
);

const MedicalSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    pet_id: { type: String, required: true, index: true },
    entry_type: { type: String, required: true },
    title: { type: String, default: null },
    body: { type: String, default: null },
    dx_items: { type: [String], default: [] },
    ddx_items: { type: [String], default: [] },
    dx_note: { type: String, default: null },
    ddx_note: { type: String, default: null },
    administered_date: { type: String, default: null },
    next_due_date: { type: String, default: null },
    reminder_days_before: { type: Number, default: null },
    external_file_path: { type: String, default: null },
    external_file_paths: { type: [String], default: [] },
    lab_result_id: { type: String, default: null },
    created_at: { type: String, required: true },
    body_weight: { type: String, default: null },
  },
  { collection: "medical_history_entries" },
);

const VaccinationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    pet_id: { type: String, required: true, index: true },
    vaccine_name: { type: String, required: true },
    administered_date: { type: String, default: null },
    next_due_date: { type: String, default: null },
    reminder_days_before: { type: Number, default: null },
    notes: { type: String, default: null },
    created_at: { type: String, required: true },
    body_weight: { type: String, default: null },
  },
  { collection: "vaccinations" },
);

const GroomingSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    pet_id: { type: String, required: true, index: true },
    service_type: { type: String, required: true },
    administered_date: { type: String, default: null },
    next_due_date: { type: String, default: null },
    reminder_days_before: { type: Number, default: null },
    performed_date: { type: String, required: true },
    notes: { type: String, default: null },
    created_at: { type: String, required: true },
    body_weight: { type: String, default: null },
  },
  { collection: "grooming_events" },
);

const HospitalizationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    pet_id: { type: String, required: true, index: true },
    cage_number: { type: String, required: true },
    check_in_date: { type: String, required: true },
    check_out_date: { type: String, default: null },
    created_at: { type: String, required: true },
  },
  { collection: "hospitalizations" },
);

const LabTestSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    code: { type: String, default: null },
    default_report_hours: { type: Number, default: null },
    active: { type: Number, required: true, default: 1 },
    created_at: { type: String, required: true },
  },
  { collection: "lab_tests" },
);

const LabAnalyteSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    lab_test_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    unit: { type: String, default: null },
    normal_min: { type: Number, default: null },
    normal_max: { type: Number, default: null },
    sort_order: { type: Number, required: true, default: 0 },
    remarks: { type: String, default: null },
  },
  { collection: "lab_analytes" },
);

const LabOrderSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    pet_id: { type: String, required: true, index: true },
    lab_test_id: { type: String, required: true },
    receipt_number: { type: String, default: null, unique: true, sparse: true },
    tentative_report_at: { type: String, default: null },
    status: { type: String, required: true, default: "pending" },
    created_at: { type: String, required: true },
  },
  { collection: "lab_orders" },
);

const LabResultValueSub = new Schema(
  {
    id: { type: String, required: true },
    analyte_id: { type: String, required: true },
    analyte_name: { type: String, required: true },
    unit: { type: String, default: null },
    normal_min: { type: Number, default: null },
    normal_max: { type: Number, default: null },
    observed_value: { type: String, required: true },
    remarks: { type: String, default: null },
  },
  { _id: false },
);

const LabResultSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    lab_order_id: { type: String, required: true, index: true },
    pet_id: { type: String, required: true },
    lab_test_id: { type: String, required: true },
    created_at: { type: String, required: true },
    notes: { type: String, default: null },
    values: { type: [LabResultValueSub], default: [] },
  },
  { collection: "lab_results" },
);

const OpdRequestSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    pet_id: { type: String, required: true, index: true },
    requested_by_user_id: { type: String, required: true },
    requested_by_name: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ["pending", "in_progress", "completed"],
      default: "pending",
      index: true,
    },
    assigned_vet_id: { type: String, default: null, index: true },
    assigned_vet_name: { type: String, default: null },
    created_at: { type: String, required: true, index: true },
    claimed_at: { type: String, default: null },
    completed_at: { type: String, default: null },
  },
  { collection: "opd_requests" },
);

const OpdMedicineSubSchema = new Schema(
  {
    name: { type: String, required: true },
    dosage: { type: String, default: null },
    direction_per_day: { type: String, default: null },
  },
  { _id: false },
);

const OpdConsultationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    request_id: { type: String, required: true, unique: true, index: true },
    pet_id: { type: String, required: true, index: true },
    vet_id: { type: String, required: true, index: true },
    vet_name: { type: String, required: true },
    doctor_signature_name: { type: String, required: true },
    temperature: { type: String, default: null },
    physical_exam: { type: String, default: null },
    history_observations: { type: [String], default: [] },
    dx_items: { type: [String], default: [] },
    ddx_items: { type: [String], default: [] },
    diagnosis_note: { type: String, default: null },
    differential_diagnosis_note: { type: String, default: null },
    symptoms: { type: [String], default: [] },
    recommended_lab_test_ids: { type: [String], default: [] },
    recommended_lab_test_names: { type: [String], default: [] },
    custom_lab_tests: { type: [String], default: [] },
    medicines: { type: [OpdMedicineSubSchema], default: [] },
    clinical_treatment_remark: { type: String, default: null },
    in_house_prescription: { type: String, default: null },
    recommended_food: { type: String, default: null },
    next_visit_at: { type: String, default: null, index: true },
    created_at: { type: String, required: true, index: true },
    body_weight: { type: String, default: null },
  },
  { collection: "opd_consultations" },
);

const OpdCatalogItemSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      required: true,
      enum: [
        "history_observation",
        "dx",
        "ddx",
        "vaccine",
        "deworming",
        "surgery",
        "surgery_dx",
        "surgery_ddx",
        "radiology_dx",
        "radiology_ddx",
        "ultrasonography_dx",
        "ultrasonography_ddx",
        "medicine",
        "food",
        "symptom",
      ],
      index: true,
    },
    name: { type: String, required: true, index: true },
    active: { type: Boolean, required: true, default: true },
    created_at: { type: String, required: true },
  },
  { collection: "opd_catalog_items" },
);

const ClinicSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    timing: { type: String, required: true },
    logo: { type: String, default: null },
    created_at: { type: String, required: true },
    updated_at: { type: String, required: true },
  },
  { collection: "clinics" },
);

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
export const Pet = mongoose.models.Pet || mongoose.model("Pet", PetSchema);

if (mongoose.models.MedicalEntry) delete mongoose.models.MedicalEntry;
export const MedicalEntry = mongoose.model("MedicalEntry", MedicalSchema);

export const Vaccination =
  mongoose.models.Vaccination ||
  mongoose.model("Vaccination", VaccinationSchema);
export const GroomingEvent =
  mongoose.models.GroomingEvent ||
  mongoose.model("GroomingEvent", GroomingSchema);
export const Hospitalization =
  mongoose.models.Hospitalization ||
  mongoose.model("Hospitalization", HospitalizationSchema);
export const LabTest =
  mongoose.models.LabTest || mongoose.model("LabTest", LabTestSchema);
export const LabAnalyte =
  mongoose.models.LabAnalyte || mongoose.model("LabAnalyte", LabAnalyteSchema);
export const LabOrder =
  mongoose.models.LabOrder || mongoose.model("LabOrder", LabOrderSchema);
export const LabResult =
  mongoose.models.LabResult || mongoose.model("LabResult", LabResultSchema);
export const OpdRequest =
  mongoose.models.OpdRequest || mongoose.model("OpdRequest", OpdRequestSchema);
export const OpdConsultation =
  mongoose.models.OpdConsultation ||
  mongoose.model("OpdConsultation", OpdConsultationSchema);

if (mongoose.models.OpdCatalogItem) delete mongoose.models.OpdCatalogItem;
export const OpdCatalogItem = mongoose.model("OpdCatalogItem", OpdCatalogItemSchema);

export const Clinic =
  mongoose.models.Clinic || mongoose.model("Clinic", ClinicSchema);
