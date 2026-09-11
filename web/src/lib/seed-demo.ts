import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { connectDb } from "@/lib/db";
import {
  Clinic,
  GroomingEvent,
  Hospitalization,
  LabAnalyte,
  LabOrder,
  LabResult,
  LabTest,
  MedicalEntry,
  OpdCatalogItem,
  OpdConsultation,
  OpdRequest,
  Pet,
  User,
  Vaccination,
} from "@/lib/models";
import type { OpdCatalogType } from "@/lib/types";

const DEMO_MARKER = "DEMO-SEED-v1";
const GLOBAL_CLINIC_ID = "global";

function isoDaysAgo(days: number, hour = 10): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function isoDaysFromNow(days: number, hour = 10): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function ensureUsers(): Promise<{
  superadminId: string;
  managerId: string;
  vetId: string;
}> {
  const now = new Date().toISOString();
  const defs = [
    {
      username: "superadmin",
      password: "superadmin",
      display_name: "Super administrator",
      role: "superadmin" as const,
    },
    {
      username: "manager",
      password: "manager",
      display_name: "Clinic manager",
      role: "manager" as const,
    },
    {
      username: "vet",
      password: "vet",
      display_name: "Dr. Ayesha Khan",
      role: "vet" as const,
    },
  ];

  const ids: Record<string, string> = {};
  for (const u of defs) {
    const existing = await User.findOne({ username: u.username }).lean();
    if (existing) {
      ids[u.username] = existing.id;
      continue;
    }
    const id = uuid();
    await User.create({
      id,
      username: u.username,
      password_hash: await bcrypt.hash(u.password, 10),
      display_name: u.display_name,
      role: u.role,
      created_at: now,
      active: true,
    });
    ids[u.username] = id;
  }

  return {
    superadminId: ids.superadmin,
    managerId: ids.manager,
    vetId: ids.vet,
  };
}

async function seedClinic(): Promise<void> {
  const now = new Date().toISOString();
  await Clinic.findOneAndUpdate(
    { id: GLOBAL_CLINIC_ID },
    {
      $set: {
        name: "Health Care",
        email: "hello@pawscare.demo",
        address: "12 Gulberg Main Blvd, Lahore",
        phone: "+92 300 1234567",
        timing: "Mon–Sat 9:00 AM – 8:00 PM",
        updated_at: now,
      },
      $setOnInsert: {
        id: GLOBAL_CLINIC_ID,
        logo: null,
        created_at: now,
      },
    },
    { upsert: true },
  );
}

async function seedOpdCatalog(): Promise<void> {
  const now = new Date().toISOString();
  const items: { type: OpdCatalogType; name: string }[] = [
    { type: "history_observation", name: "Reduced appetite" },
    { type: "history_observation", name: "Vomiting" },
    { type: "history_observation", name: "Lethargy" },
    { type: "history_observation", name: "Coughing" },
    { type: "history_observation", name: "Itching / scratching" },
    { type: "symptom", name: "Fever" },
    { type: "symptom", name: "Diarrhea" },
    { type: "symptom", name: "Limping" },
    { type: "symptom", name: "Ear discharge" },
    { type: "dx", name: "Gastroenteritis" },
    { type: "dx", name: "Otitis externa" },
    { type: "dx", name: "Dermatitis" },
    { type: "dx", name: "Upper respiratory infection" },
    { type: "ddx", name: "Parvoviral enteritis" },
    { type: "ddx", name: "Dietary indiscretion" },
    { type: "ddx", name: "Allergic dermatitis" },
    { type: "vaccine", name: "DHPP" },
    { type: "vaccine", name: "Rabies" },
    { type: "vaccine", name: "Bordetella" },
    { type: "deworming", name: "Pyrantel pamoate" },
    { type: "deworming", name: "Fenbendazole" },
    { type: "medicine", name: "Amoxicillin" },
    { type: "medicine", name: "Metronidazole" },
    { type: "medicine", name: "Carprofen" },
    { type: "medicine", name: "Cetirizine" },
    { type: "food", name: "Hill's i/d" },
    { type: "food", name: "Royal Canin Gastrointestinal" },
    { type: "surgery", name: "Spay / Neuter" },
    { type: "surgery", name: "Wound debridement" },
    { type: "surgery_dx", name: "Pyometra" },
    { type: "surgery_ddx", name: "Foreign body obstruction" },
    { type: "radiology_dx", name: "Pulmonary pattern" },
    { type: "radiology_ddx", name: "Cardiomegaly" },
    { type: "ultrasonography_dx", name: "Cystitis" },
    { type: "ultrasonography_ddx", name: "Hepatic lipidosis" },
  ];

  for (const item of items) {
    const exists = await OpdCatalogItem.findOne({
      type: item.type,
      name: item.name,
    }).lean();
    if (exists) continue;
    await OpdCatalogItem.create({
      id: uuid(),
      type: item.type,
      name: item.name,
      active: true,
      created_at: now,
    });
  }
}

async function seedLabCatalog(): Promise<{
  cbcId: string;
  biochemId: string;
  analyteByKey: Record<string, { id: string; name: string; unit: string | null; min: number | null; max: number | null }>;
}> {
  const now = new Date().toISOString();

  async function upsertTest(
    name: string,
    code: string,
    hours: number,
  ): Promise<string> {
    const existing = await LabTest.findOne({ code }).lean();
    if (existing) return existing.id;
    const id = uuid();
    await LabTest.create({
      id,
      name,
      code,
      default_report_hours: hours,
      active: 1,
      created_at: now,
    });
    return id;
  }

  const cbcId = await upsertTest("Complete Blood Count", "CBC", 4);
  const biochemId = await upsertTest("Serum Biochemistry", "BIOCHEM", 6);

  const analyteDefs: {
    testId: string;
    key: string;
    name: string;
    unit: string;
    min: number;
    max: number;
    order: number;
  }[] = [
    { testId: cbcId, key: "wbc", name: "WBC", unit: "x10^9/L", min: 6, max: 17, order: 1 },
    { testId: cbcId, key: "rbc", name: "RBC", unit: "x10^12/L", min: 5.5, max: 8.5, order: 2 },
    { testId: cbcId, key: "hgb", name: "Hemoglobin", unit: "g/dL", min: 12, max: 18, order: 3 },
    { testId: cbcId, key: "plt", name: "Platelets", unit: "x10^9/L", min: 200, max: 500, order: 4 },
    { testId: biochemId, key: "alt", name: "ALT", unit: "U/L", min: 10, max: 125, order: 1 },
    { testId: biochemId, key: "crea", name: "Creatinine", unit: "mg/dL", min: 0.5, max: 1.8, order: 2 },
    { testId: biochemId, key: "bun", name: "BUN", unit: "mg/dL", min: 7, max: 27, order: 3 },
    { testId: biochemId, key: "gluc", name: "Glucose", unit: "mg/dL", min: 70, max: 120, order: 4 },
  ];

  const analyteByKey: Record<
    string,
    { id: string; name: string; unit: string | null; min: number | null; max: number | null }
  > = {};

  for (const a of analyteDefs) {
    const existing = await LabAnalyte.findOne({
      lab_test_id: a.testId,
      name: a.name,
    }).lean();
    const id = existing?.id ?? uuid();
    if (!existing) {
      await LabAnalyte.create({
        id,
        lab_test_id: a.testId,
        name: a.name,
        unit: a.unit,
        normal_min: a.min,
        normal_max: a.max,
        sort_order: a.order,
        remarks: null,
      });
    }
    analyteByKey[a.key] = {
      id,
      name: a.name,
      unit: a.unit,
      min: a.min,
      max: a.max,
    };
  }

  return { cbcId, biochemId, analyteByKey };
}

type DemoPetSeed = {
  card_id: string;
  name: string;
  species: string;
  breed: string;
  age: string;
  date_of_birth: string;
  sex: string;
  weight: string;
  vaccine_status: string;
  deworming_status: string;
  owner_name: string;
  owner_phone: string;
  owner_address: string;
  owner_email: string;
  notes: string;
};

async function seedPets(): Promise<Record<string, string>> {
  const now = new Date().toISOString();
  const pets: DemoPetSeed[] = [
    {
      card_id: "DEMO-PET-001",
      name: "Buddy",
      species: "Dog",
      breed: "Golden Retriever",
      age: "3 years",
      date_of_birth: "2023-03-12",
      sex: "Male",
      weight: "28 kg",
      vaccine_status: "Up to date",
      deworming_status: "Due soon",
      owner_name: "Ali Raza",
      owner_phone: "+92 321 5550101",
      owner_address: "DHA Phase 5, Lahore",
      owner_email: "ali.raza@demo.local",
      notes: `${DEMO_MARKER} Friendly; annual wellness patient`,
    },
    {
      card_id: "DEMO-PET-002",
      name: "Mimi",
      species: "Cat",
      breed: "Persian",
      age: "2 years",
      date_of_birth: "2024-01-20",
      sex: "Female",
      weight: "3.8 kg",
      vaccine_status: "Due",
      deworming_status: "Up to date",
      owner_name: "Sara Ahmed",
      owner_phone: "+92 333 5550202",
      owner_address: "Johar Town, Lahore",
      owner_email: "sara.ahmed@demo.local",
      notes: `${DEMO_MARKER} Indoor cat; mild seasonal itching`,
    },
    {
      card_id: "DEMO-PET-003",
      name: "Rocky",
      species: "Dog",
      breed: "German Shepherd",
      age: "5 years",
      date_of_birth: "2021-06-08",
      sex: "Male",
      weight: "34 kg",
      vaccine_status: "Up to date",
      deworming_status: "Up to date",
      owner_name: "Hassan Malik",
      owner_phone: "+92 300 5550303",
      owner_address: "Bahria Town, Lahore",
      owner_email: "hassan.malik@demo.local",
      notes: `${DEMO_MARKER} Post-op monitoring; hospitalization demo`,
    },
    {
      card_id: "DEMO-PET-004",
      name: "Coco",
      species: "Dog",
      breed: "Poodle",
      age: "1 year",
      date_of_birth: "2025-02-14",
      sex: "Female",
      weight: "6.5 kg",
      vaccine_status: "Puppy series",
      deworming_status: "Up to date",
      owner_name: "Nadia Khan",
      owner_phone: "+92 345 5550404",
      owner_address: "Model Town, Lahore",
      owner_email: "nadia.khan@demo.local",
      notes: `${DEMO_MARKER} Grooming regular; first OPD visit pending`,
    },
    {
      card_id: "DEMO-PET-005",
      name: "Simba",
      species: "Cat",
      breed: "Domestic Shorthair",
      age: "4 years",
      date_of_birth: "2022-09-01",
      sex: "Male",
      weight: "4.2 kg",
      vaccine_status: "Up to date",
      deworming_status: "Up to date",
      owner_name: "Omar Farooq",
      owner_phone: "+92 312 5550505",
      owner_address: "Cantt, Lahore",
      owner_email: "omar.farooq@demo.local",
      notes: `${DEMO_MARKER} Lab work completed for checkup`,
    },
  ];

  const ids: Record<string, string> = {};
  for (const p of pets) {
    const existing = await Pet.findOne({ card_id: p.card_id }).lean();
    if (existing) {
      ids[p.card_id] = existing.id;
      continue;
    }
    const id = uuid();
    await Pet.create({
      id,
      ...p,
      created_at: now,
      updated_at: now,
    });
    ids[p.card_id] = id;
  }
  return ids;
}

async function seedPetClinicalData(
  petIds: Record<string, string>,
  users: { managerId: string; vetId: string },
  lab: Awaited<ReturnType<typeof seedLabCatalog>>,
): Promise<void> {
  const buddy = petIds["DEMO-PET-001"];
  const mimi = petIds["DEMO-PET-002"];
  const rocky = petIds["DEMO-PET-003"];
  const coco = petIds["DEMO-PET-004"];
  const simba = petIds["DEMO-PET-005"];

  const hasMed = await MedicalEntry.findOne({
    pet_id: buddy,
    title: "Annual wellness exam",
  }).lean();
  if (!hasMed) {
    await MedicalEntry.insertMany([
      {
        id: uuid(),
        pet_id: buddy,
        entry_type: "note",
        title: "Annual wellness exam",
        body: "Bright, alert, hydrated. Heart/lungs clear. Mild tartar noted.",
        dx_items: [],
        ddx_items: [],
        administered_date: isoDaysAgo(40).slice(0, 10),
        next_due_date: null,
        reminder_days_before: null,
        external_file_path: null,
        external_file_paths: [],
        lab_result_id: null,
        created_at: isoDaysAgo(40),
        body_weight: "28 kg",
      },
      {
        id: uuid(),
        pet_id: buddy,
        entry_type: "deworming",
        title: "Fenbendazole",
        body: "Routine deworming course completed.",
        dx_items: [],
        ddx_items: [],
        administered_date: isoDaysAgo(20).slice(0, 10),
        next_due_date: isoDaysFromNow(70).slice(0, 10),
        reminder_days_before: 7,
        external_file_path: null,
        external_file_paths: [],
        lab_result_id: null,
        created_at: isoDaysAgo(20),
        body_weight: "28 kg",
      },
      {
        id: uuid(),
        pet_id: mimi,
        entry_type: "note",
        title: "Dermatology consult",
        body: "Mild pruritus on flanks. Recommend hypoallergenic diet trial.",
        dx_items: ["Dermatitis"],
        ddx_items: ["Allergic dermatitis"],
        administered_date: isoDaysAgo(12).slice(0, 10),
        next_due_date: null,
        reminder_days_before: null,
        external_file_path: null,
        external_file_paths: [],
        lab_result_id: null,
        created_at: isoDaysAgo(12),
        body_weight: "3.8 kg",
      },
      {
        id: uuid(),
        pet_id: rocky,
        entry_type: "surgery",
        title: "Wound debridement",
        body: "Clean laceration on left flank. Sutured under sedation.",
        dx_items: [],
        ddx_items: [],
        administered_date: isoDaysAgo(3).slice(0, 10),
        next_due_date: isoDaysFromNow(10).slice(0, 10),
        reminder_days_before: 2,
        external_file_path: null,
        external_file_paths: [],
        lab_result_id: null,
        created_at: isoDaysAgo(3),
        body_weight: "34 kg",
      },
    ]);
  }

  const hasVax = await Vaccination.findOne({ pet_id: buddy, vaccine_name: "Rabies" }).lean();
  if (!hasVax) {
    await Vaccination.insertMany([
      {
        id: uuid(),
        pet_id: buddy,
        vaccine_name: "Rabies",
        administered_date: isoDaysAgo(90).slice(0, 10),
        next_due_date: isoDaysFromNow(275).slice(0, 10),
        reminder_days_before: 14,
        notes: "Annual booster",
        created_at: isoDaysAgo(90),
        body_weight: "27.5 kg",
      },
      {
        id: uuid(),
        pet_id: buddy,
        vaccine_name: "DHPP",
        administered_date: isoDaysAgo(90).slice(0, 10),
        next_due_date: isoDaysFromNow(275).slice(0, 10),
        reminder_days_before: 14,
        notes: null,
        created_at: isoDaysAgo(90),
        body_weight: "27.5 kg",
      },
      {
        id: uuid(),
        pet_id: mimi,
        vaccine_name: "FVRCP",
        administered_date: isoDaysAgo(200).slice(0, 10),
        next_due_date: isoDaysFromNow(5).slice(0, 10),
        reminder_days_before: 7,
        notes: "Due for booster",
        created_at: isoDaysAgo(200),
        body_weight: "3.6 kg",
      },
      {
        id: uuid(),
        pet_id: coco,
        vaccine_name: "DHPP",
        administered_date: isoDaysAgo(14).slice(0, 10),
        next_due_date: isoDaysFromNow(14).slice(0, 10),
        reminder_days_before: 3,
        notes: "Puppy series dose 2",
        created_at: isoDaysAgo(14),
        body_weight: "6.2 kg",
      },
    ]);
  }

  const hasGroom = await GroomingEvent.findOne({ pet_id: coco }).lean();
  if (!hasGroom) {
    await GroomingEvent.insertMany([
      {
        id: uuid(),
        pet_id: coco,
        service_type: "Full groom + nail trim",
        administered_date: isoDaysAgo(7).slice(0, 10),
        next_due_date: isoDaysFromNow(45).slice(0, 10),
        reminder_days_before: 5,
        performed_date: isoDaysAgo(7).slice(0, 10),
        notes: "Coat clipped short for summer",
        created_at: isoDaysAgo(7),
        body_weight: "6.5 kg",
      },
      {
        id: uuid(),
        pet_id: buddy,
        service_type: "Bath + brush",
        administered_date: isoDaysAgo(30).slice(0, 10),
        next_due_date: isoDaysFromNow(30).slice(0, 10),
        reminder_days_before: 5,
        performed_date: isoDaysAgo(30).slice(0, 10),
        notes: null,
        created_at: isoDaysAgo(30),
        body_weight: "28 kg",
      },
    ]);
  }

  const hasHosp = await Hospitalization.findOne({ pet_id: rocky }).lean();
  if (!hasHosp) {
    await Hospitalization.create({
      id: uuid(),
      pet_id: rocky,
      cage_number: "C-04",
      check_in_date: isoDaysAgo(2),
      check_out_date: null,
      created_at: isoDaysAgo(2),
    });
  }

  // Completed lab order + result for Simba
  const existingOrder = await LabOrder.findOne({
    pet_id: simba,
    receipt_number: "DEMO-RCPT-1001",
  }).lean();
  if (!existingOrder) {
    const orderId = uuid();
    const resultId = uuid();
    await LabOrder.create({
      id: orderId,
      pet_id: simba,
      lab_test_id: lab.cbcId,
      receipt_number: "DEMO-RCPT-1001",
      tentative_report_at: isoDaysAgo(1, 14),
      status: "completed",
      created_at: isoDaysAgo(1, 9),
    });

    const values = [
      { key: "wbc", observed: "11.2" },
      { key: "rbc", observed: "6.8" },
      { key: "hgb", observed: "15.1" },
      { key: "plt", observed: "312" },
    ].map((v) => {
      const a = lab.analyteByKey[v.key];
      return {
        id: uuid(),
        analyte_id: a.id,
        analyte_name: a.name,
        unit: a.unit,
        normal_min: a.min,
        normal_max: a.max,
        observed_value: v.observed,
        remarks: null,
      };
    });

    await LabResult.create({
      id: resultId,
      lab_order_id: orderId,
      pet_id: simba,
      lab_test_id: lab.cbcId,
      created_at: isoDaysAgo(1, 13),
      notes: "All values within normal limits.",
      values,
    });

    await MedicalEntry.create({
      id: uuid(),
      pet_id: simba,
      entry_type: "lab_report",
      title: "CBC report",
      body: "Routine pre-anesthetic / wellness CBC.",
      dx_items: [],
      ddx_items: [],
      administered_date: isoDaysAgo(1).slice(0, 10),
      next_due_date: null,
      reminder_days_before: null,
      external_file_path: null,
      external_file_paths: [],
      lab_result_id: resultId,
      created_at: isoDaysAgo(1, 13),
      body_weight: "4.2 kg",
    });
  }

  // Pending lab order for Mimi
  const pending = await LabOrder.findOne({
    pet_id: mimi,
    receipt_number: "DEMO-RCPT-1002",
  }).lean();
  if (!pending) {
    await LabOrder.create({
      id: uuid(),
      pet_id: mimi,
      lab_test_id: lab.biochemId,
      receipt_number: "DEMO-RCPT-1002",
      tentative_report_at: isoDaysFromNow(0, 18),
      status: "pending",
      created_at: isoDaysAgo(0, 9),
    });
  }

  // OPD: completed consult for Buddy, pending for Coco, in_progress for Mimi
  const completedReq = await OpdRequest.findOne({
    pet_id: buddy,
    requested_by_user_id: users.managerId,
    status: "completed",
  }).lean();
  if (!completedReq) {
    const requestId = uuid();
    await OpdRequest.create({
      id: requestId,
      pet_id: buddy,
      requested_by_user_id: users.managerId,
      requested_by_name: "Clinic manager",
      status: "completed",
      assigned_vet_id: users.vetId,
      assigned_vet_name: "Dr. Ayesha Khan",
      created_at: isoDaysAgo(5, 9),
      claimed_at: isoDaysAgo(5, 9),
      completed_at: isoDaysAgo(5, 10),
    });
    await OpdConsultation.create({
      id: uuid(),
      request_id: requestId,
      pet_id: buddy,
      vet_id: users.vetId,
      vet_name: "Dr. Ayesha Khan",
      doctor_signature_name: "Dr. Ayesha Khan",
      temperature: "101.4 F",
      physical_exam: "NAD. Mild dental tartar.",
      history_observations: ["Reduced appetite"],
      dx_items: ["Gastroenteritis"],
      ddx_items: ["Dietary indiscretion"],
      diagnosis_note: "Mild GI upset after scavenged food.",
      differential_diagnosis_note: null,
      symptoms: ["Diarrhea"],
      recommended_lab_test_ids: [],
      recommended_lab_test_names: [],
      custom_lab_tests: [],
      medicines: [
        {
          name: "Metronidazole",
          dosage: "250 mg",
          direction_per_day: "BID x 5 days",
        },
      ],
      clinical_treatment_remark: "Bland diet for 3 days.",
      in_house_prescription: null,
      recommended_food: "Hill's i/d",
      next_visit_at: isoDaysFromNow(14),
      created_at: isoDaysAgo(5, 10),
      body_weight: "28 kg",
    });
  }

  const inProgress = await OpdRequest.findOne({
    pet_id: mimi,
    status: "in_progress",
  }).lean();
  if (!inProgress) {
    await OpdRequest.create({
      id: uuid(),
      pet_id: mimi,
      requested_by_user_id: users.managerId,
      requested_by_name: "Clinic manager",
      status: "in_progress",
      assigned_vet_id: users.vetId,
      assigned_vet_name: "Dr. Ayesha Khan",
      created_at: isoDaysAgo(0, 8),
      claimed_at: isoDaysAgo(0, 8),
      completed_at: null,
    });
  }

  const pendingOpd = await OpdRequest.findOne({
    pet_id: coco,
    status: "pending",
  }).lean();
  if (!pendingOpd) {
    await OpdRequest.create({
      id: uuid(),
      pet_id: coco,
      requested_by_user_id: users.managerId,
      requested_by_name: "Clinic manager",
      status: "pending",
      assigned_vet_id: null,
      assigned_vet_name: null,
      created_at: isoDaysAgo(0, 10),
      claimed_at: null,
      completed_at: null,
    });
  }
}

export type SeedDemoResult = {
  skipped: boolean;
  message: string;
  users: { username: string; password: string; role: string }[];
  pets: string[];
};

/**
 * Idempotent demo dataset for local/dev demos.
 * Safe to re-run: existing DEMO-* pets / receipts are reused, not duplicated.
 */
export async function seedDemoData(options?: {
  force?: boolean;
}): Promise<SeedDemoResult> {
  await connectDb();

  if (!options?.force) {
    const existingDemoPets = await Pet.countDocuments({
      card_id: { $regex: /^DEMO-PET-/ },
    });
    if (existingDemoPets >= 5) {
      return {
        skipped: true,
        message:
          "Demo data already present (DEMO-PET-* found). Re-run with force to refresh clinic/catalog only.",
        users: [
          { username: "superadmin", password: "superadmin", role: "superadmin" },
          { username: "manager", password: "manager", role: "manager" },
          { username: "vet", password: "vet", role: "vet" },
        ],
        pets: [
          "DEMO-PET-001 Buddy",
          "DEMO-PET-002 Mimi",
          "DEMO-PET-003 Rocky",
          "DEMO-PET-004 Coco",
          "DEMO-PET-005 Simba",
        ],
      };
    }
  }

  const users = await ensureUsers();
  await seedClinic();
  await seedOpdCatalog();
  const lab = await seedLabCatalog();
  const petIds = await seedPets();
  await seedPetClinicalData(petIds, users, lab);

  return {
    skipped: false,
    message: "Demo data seeded successfully.",
    users: [
      { username: "superadmin", password: "superadmin", role: "superadmin" },
      { username: "manager", password: "manager", role: "manager" },
      { username: "vet", password: "vet", role: "vet" },
    ],
    pets: [
      "DEMO-PET-001 Buddy (Dog)",
      "DEMO-PET-002 Mimi (Cat)",
      "DEMO-PET-003 Rocky (Dog, hospitalized)",
      "DEMO-PET-004 Coco (Dog, pending OPD)",
      "DEMO-PET-005 Simba (Cat, lab result)",
    ],
  };
}
