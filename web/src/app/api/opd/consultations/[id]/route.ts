import { requireSession } from "@/lib/auth/session";
import { connectDb, updatePetWeight } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabTest, OpdConsultation, OpdRequest, Pet } from "@/lib/models";
import { toOpdConsultationRow } from "@/lib/opd";
import { assertCanManageClinic } from "@/lib/permissions";
import type { OpdConsultationInput, OpdMedicineInput } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function normalizeStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((x) => x.trim()).filter(Boolean);
}

function normalizeNullable(value: string | undefined | null): string | null {
  const v = value?.trim() ?? "";
  return v || null;
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

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const { id } = await ctx.params;
    const body = (await req.json()) as { input?: OpdConsultationInput };
    const input = body.input;
    if (!input?.doctor_signature_name?.trim()) {
      return jsonError("doctor_signature_name is required", 400);
    }
    const consultation = await OpdConsultation.findOne({ id }).lean();
    if (!consultation) return jsonError("OPD consultation not found", 404);

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
      .map((testId) => testNameById[testId])
      .filter(Boolean);

    await OpdConsultation.updateOne(
      { id },
      {
        doctor_signature_name: input.doctor_signature_name.trim(),
        temperature: normalizeNullable(input.temperature),
        body_weight: normalizeNullable(input.body_weight),
        physical_exam: normalizeNullable(input.physical_exam),
        history_observations: normalizeStrings(input.history_observations),
        dx_items: normalizeStrings(input.dx_items),
        ddx_items: normalizeStrings(input.ddx_items),
        diagnosis_note: normalizeNullable(input.diagnosis_note),
        differential_diagnosis_note: normalizeNullable(
          input.differential_diagnosis_note,
        ),
        symptoms: normalizeStrings(input.symptoms),
        recommended_lab_test_ids: recommendedLabTestIds,
        recommended_lab_test_names: recommendedLabTestNames,
        custom_lab_tests: normalizeStrings(input.custom_lab_tests),
        medicines: normalizeMedicines(input.medicines),
        clinical_treatment_remark: normalizeNullable(
          input.clinical_treatment_remark,
        ),
        in_house_prescription: normalizeNullable(input.in_house_prescription),
        recommended_food: normalizeNullable(input.recommended_food),
        next_visit_at: input.next_visit_at || null,
      },
    );

    if (input.request_id?.trim()) {
      await OpdRequest.updateOne(
        { id: input.request_id.trim() },
        { status: "completed", completed_at: new Date().toISOString() },
      );
    }

    const updated = await OpdConsultation.findOne({ id }).lean();
    if (!updated) return jsonError("Could not update consultation", 500);

    if (input.body_weight) {
      await updatePetWeight(updated.pet_id, input.body_weight);
    }
    const pet = await Pet.findOne({ id: updated.pet_id })
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
    return jsonOk(toOpdConsultationRow(updated, petById));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const { id } = await ctx.params;
    const deleted = await OpdConsultation.findOneAndDelete({ id }).lean();
    if (!deleted) return jsonError("OPD consultation not found", 404);
    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
