import { v4 as uuid } from "uuid";
import { requireSession } from "@/lib/auth/session";
import { connectDb, updatePetWeight } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabTest, OpdConsultation, OpdRequest, Pet } from "@/lib/models";
import { toOpdConsultationRow } from "@/lib/opd";
import { assertCanManageClinic } from "@/lib/permissions";
import type {
  OpdConsultationInput,
  OpdConsultationRow,
  OpdMedicineInput,
} from "@/lib/types";

export const runtime = "nodejs";

function normalizeStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((x) => x.trim()).filter(Boolean);
}

function normalizeMedicines(values: OpdMedicineInput[] | undefined) {
  return (values ?? [])
    .map((m) => ({
      name: m.name?.trim() ?? "",
      dosage: m.dosage?.trim() || null,
      direction_per_day: m.direction_per_day?.trim() || null,
    }))
    .filter((m) => Boolean(m.name));
}

function normalizeNullable(value: string | undefined | null): string | null {
  const v = value?.trim() ?? "";
  return v || null;
}

export async function GET(req: Request) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const url = new URL(req.url);
    const petId = url.searchParams.get("petId")?.trim();
    const mine = url.searchParams.get("mine") === "1";
    const filter: Record<string, string> = {};
    if (petId) filter.pet_id = petId;
    if (mine && session.role === "vet") filter.vet_id = session.id;

    const consultations = await OpdConsultation.find(filter)
      .sort({ created_at: -1 })
      .lean();
    const petIds = [...new Set(consultations.map((c) => String(c.pet_id)))];
    const pets = await Pet.find({ id: { $in: petIds } })
      .select(
        "id name card_id species breed age date_of_birth sex weight owner_name owner_phone",
      )
      .lean();
    const petById = Object.fromEntries(
      pets.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          card_id: p.card_id,
          species: p.species ?? null,
          breed: p.breed ?? null,
          age: p.age ?? null,
          date_of_birth: p.date_of_birth ?? null,
          sex: p.sex ?? null,
          weight: p.weight ?? null,
          owner_name: p.owner_name ?? null,
          owner_phone: p.owner_phone ?? null,
        },
      ]),
    );

    const out: OpdConsultationRow[] = consultations.map((c) =>
      toOpdConsultationRow(c, petById),
    );
    return jsonOk(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function POST(req: Request) {
  try {
    await connectDb();
    const session = await requireSession();
    if (session.role !== "vet") {
      return jsonError("Only vets can submit OPD consultation", 403);
    }
    const body = (await req.json()) as { input?: OpdConsultationInput };
    const input = body.input;
    if (!input?.request_id) return jsonError("request_id is required", 400);
    if (!input.doctor_signature_name?.trim()) {
      return jsonError("doctor_signature_name is required", 400);
    }

    const requestDoc = await OpdRequest.findOne({
      id: input.request_id,
    }).lean();
    if (!requestDoc) return jsonError("OPD request not found", 404);
    if (requestDoc.status === "completed") {
      return jsonError("This OPD request is already completed", 409);
    }

    const existingConsultation = await OpdConsultation.findOne({
      request_id: input.request_id,
    }).lean();
    if (
      requestDoc.assigned_vet_id &&
      requestDoc.assigned_vet_id !== session.id &&
      !existingConsultation
    ) {
      return jsonError("This OPD request is assigned to another vet", 409);
    }

    await OpdRequest.updateOne(
      { id: input.request_id },
      {
        status: "in_progress",
        assigned_vet_id: session.id,
        assigned_vet_name: session.display_name,
        claimed_at: requestDoc.claimed_at ?? new Date().toISOString(),
      },
    );

    const recommendedLabTestIds = normalizeStrings(
      input.recommended_lab_test_ids,
    );
    const testDocs =
      recommendedLabTestIds.length > 0
        ? await LabTest.find({ id: { $in: recommendedLabTestIds } })
            .select("id name")
            .lean()
        : [];
    const testNameById = Object.fromEntries(
      testDocs.map((t) => [t.id, t.name]),
    );
    const recommendedLabTestNames = recommendedLabTestIds
      .filter((id) => id in testNameById)
      .map((id) => testNameById[id]);

    const now = new Date().toISOString();
    let created;

    if (existingConsultation) {
      // Update existing consultation
      await OpdConsultation.updateOne(
        { id: existingConsultation.id },
        {
          doctor_signature_name: input.doctor_signature_name.trim(),
          temperature: normalizeNullable(input.temperature),
          body_weight: normalizeNullable(input.body_weight),
          physical_exam: normalizeNullable(input.physical_exam),
          history_observations: normalizeStrings(input.history_observations),
          dx_items: normalizeStrings(input.dx_items),
          ddx_items: normalizeStrings(input.ddx_items),
          diagnosis_note: input.diagnosis_note?.trim() || null,
          differential_diagnosis_note:
            input.differential_diagnosis_note?.trim() || null,
          symptoms: normalizeStrings(input.symptoms),
          recommended_lab_test_ids: recommendedLabTestIds,
          recommended_lab_test_names: recommendedLabTestNames,
          custom_lab_tests: normalizeStrings(input.custom_lab_tests),
          medicines: normalizeMedicines(input.medicines),
          clinical_treatment_remark: normalizeNullable(
            input.clinical_treatment_remark,
          ),
          in_house_prescription: normalizeNullable(input.in_house_prescription),
          recommended_food: input.recommended_food?.trim() || null,
          next_visit_at: input.next_visit_at || null,
        },
      );
      created = await OpdConsultation.findOne({
        id: existingConsultation.id,
      }).lean();
    } else {
      // Create new consultation
      const id = uuid();
      await OpdConsultation.create({
        id,
        request_id: input.request_id,
        pet_id: requestDoc.pet_id,
        vet_id: session.id,
        vet_name: session.display_name,
        doctor_signature_name: input.doctor_signature_name.trim(),
        temperature: normalizeNullable(input.temperature),
        body_weight: normalizeNullable(input.body_weight),
        physical_exam: normalizeNullable(input.physical_exam),
        history_observations: normalizeStrings(input.history_observations),
        dx_items: normalizeStrings(input.dx_items),
        ddx_items: normalizeStrings(input.ddx_items),
        diagnosis_note: input.diagnosis_note?.trim() || null,
        differential_diagnosis_note:
          input.differential_diagnosis_note?.trim() || null,
        symptoms: normalizeStrings(input.symptoms),
        recommended_lab_test_ids: recommendedLabTestIds,
        recommended_lab_test_names: recommendedLabTestNames,
        custom_lab_tests: normalizeStrings(input.custom_lab_tests),
        medicines: normalizeMedicines(input.medicines),
        clinical_treatment_remark: normalizeNullable(
          input.clinical_treatment_remark,
        ),
        in_house_prescription: normalizeNullable(input.in_house_prescription),
        recommended_food: input.recommended_food?.trim() || null,
        next_visit_at: input.next_visit_at || null,
        created_at: now,
      });
      created = await OpdConsultation.findOne({ id }).lean();
    }
    if (!created) return jsonError("Could not save consultation", 500);

    if (input.body_weight) {
      await updatePetWeight(requestDoc.pet_id, input.body_weight);
    }

    await OpdRequest.updateOne(
      { id: input.request_id },
      {
        status: "completed",
        assigned_vet_id: session.id,
        assigned_vet_name: session.display_name,
        completed_at: now,
      },
    );

    const pet = await Pet.findOne({ id: created.pet_id })
      .select(
        "id name card_id species breed age date_of_birth sex weight owner_name owner_phone",
      )
      .lean();
    const petById = pet
      ? {
          [pet.id]: {
            id: pet.id,
            name: pet.name,
            card_id: pet.card_id,
            species: pet.species ?? null,
            breed: pet.breed ?? null,
            age: pet.age ?? null,
            date_of_birth: pet.date_of_birth ?? null,
            sex: pet.sex ?? null,
            weight: pet.weight ?? null,
            owner_name: pet.owner_name ?? null,
            owner_phone: pet.owner_phone ?? null,
          },
        }
      : {};
    const row: OpdConsultationRow = toOpdConsultationRow(created, petById);
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[OPD Consultation POST Error]", msg, e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : msg || "Server error", status);
  }
}
