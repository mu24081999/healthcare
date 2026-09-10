import type {
  OpdCatalogItemRow,
  OpdCatalogType,
  OpdConsultationRow,
  OpdRequestRow,
} from "@/lib/types";

type LeanPet = {
  id: string;
  name: string;
  card_id: string;
  species: string | null;
  breed: string | null;
  weight: string | null;
  age: string | null;
  date_of_birth: string | null;
  sex: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
};

type LeanOpdRequest = {
  id: string;
  pet_id: string;
  requested_by_user_id: string;
  requested_by_name: string;
  status: "pending" | "in_progress" | "completed";
  assigned_vet_id?: string | null;
  assigned_vet_name?: string | null;
  created_at: string;
  claimed_at?: string | null;
  completed_at?: string | null;
};

type LeanOpdConsultation = {
  id: string;
  request_id: string;
  pet_id: string;
  vet_id: string;
  vet_name: string;
  doctor_signature_name: string;
  temperature?: string | null;
  physical_exam?: string | null;
  history_observations?: string[];
  dx_items?: string[];
  ddx_items?: string[];
  diagnosis_note?: string | null;
  differential_diagnosis_note?: string | null;
  symptoms?: string[];
  recommended_lab_test_ids?: string[];
  recommended_lab_test_names?: string[];
  custom_lab_tests?: string[];
  medicines?: Array<{
    name: string;
    dosage?: string | null;
    direction_per_day?: string | null;
  }>;
  clinical_treatment_remark?: string | null;
  in_house_prescription?: string | null;
  recommended_food?: string | null;
  next_visit_at?: string | null;
  created_at: string;
  body_weight?: string | null;
};

type LeanCatalogItem = {
  id: string;
  type: OpdCatalogType;
  name: string;
  active?: boolean;
  created_at: string;
};

export function toOpdRequestRow(
  request: LeanOpdRequest,
  petById: Record<string, LeanPet>,
): OpdRequestRow {
  const pet = petById[request.pet_id];
  return {
    id: request.id,
    pet_id: request.pet_id,
    pet_name: pet?.name ?? "Unknown pet",
    pet_card_id: pet?.card_id ?? "—",
    species: pet?.species ?? null,
    breed: pet?.breed ?? null,
    weight: pet?.weight ?? null,
    age: pet?.age ?? null,
    date_of_birth: pet?.date_of_birth ?? null,
    sex: pet?.sex ?? null,
    owner_name: pet?.owner_name ?? null,
    owner_phone: pet?.owner_phone ?? null,
    requested_by_user_id: request.requested_by_user_id,
    requested_by_name: request.requested_by_name,
    status: request.status,
    assigned_vet_id: request.assigned_vet_id ?? null,
    assigned_vet_name: request.assigned_vet_name ?? null,
    created_at: request.created_at,
    claimed_at: request.claimed_at ?? null,
    completed_at: request.completed_at ?? null,
  };
}

export function toOpdConsultationRow(
  consultation: LeanOpdConsultation,
  petById: Record<string, LeanPet>,
): OpdConsultationRow {
  const pet = petById[consultation.pet_id];
  return {
    id: consultation.id,
    request_id: consultation.request_id,
    pet_id: consultation.pet_id,
    pet_name: pet?.name ?? "Unknown pet",
    pet_card_id: pet?.card_id ?? "—",
    species: pet?.species ?? null,
    breed: pet?.breed ?? null,
    weight: pet?.weight ?? null,
    age: pet?.age ?? null,
    date_of_birth: pet?.date_of_birth ?? null,
    sex: pet?.sex ?? null,
    owner_name: pet?.owner_name ?? null,
    owner_phone: pet?.owner_phone ?? null,
    vet_id: consultation.vet_id,
    vet_name: consultation.vet_name,
    doctor_signature_name: consultation.doctor_signature_name,
    temperature: consultation.temperature ?? null,
    physical_exam: consultation.physical_exam ?? null,
    history_observations: consultation.history_observations ?? [],
    dx_items: consultation.dx_items ?? [],
    ddx_items: consultation.ddx_items ?? [],
    diagnosis_note: consultation.diagnosis_note ?? null,
    differential_diagnosis_note:
      consultation.differential_diagnosis_note ?? null,
    symptoms: consultation.symptoms ?? [],
    recommended_lab_test_ids: consultation.recommended_lab_test_ids ?? [],
    recommended_lab_test_names: consultation.recommended_lab_test_names ?? [],
    custom_lab_tests: consultation.custom_lab_tests ?? [],
    medicines: (consultation.medicines ?? []).map((m) => ({
      name: m.name,
      dosage: m.dosage ?? null,
      direction_per_day: m.direction_per_day ?? null,
    })),

    clinical_treatment_remark: consultation.clinical_treatment_remark ?? null,
    in_house_prescription: consultation.in_house_prescription ?? null,
    recommended_food: consultation.recommended_food ?? null,
    next_visit_at: consultation.next_visit_at ?? null,
    created_at: consultation.created_at,
    body_weight: consultation.body_weight ?? null,
  };
}

export function toOpdCatalogItemRow(item: LeanCatalogItem): OpdCatalogItemRow {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    active: item.active !== false,
    created_at: item.created_at,
  };
}

export function startOfTodayIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function startOfWeekIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString();
}

export function startOfMonthIso(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), 1);
  return d.toISOString();
}
