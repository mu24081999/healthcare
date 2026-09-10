import { requireSession } from "@/lib/auth/session";
import { connectDb, updatePetWeight } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabOrder, LabResult, MedicalEntry } from "@/lib/models";
import { assertCanManageClinic } from "@/lib/permissions";
import type { MedicalInput, MedicalRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string; entryId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    const { petId, entryId } = await ctx.params;
    const body = (await req.json()) as { input?: MedicalInput };
    const input = body.input;
    if (!input?.entry_type) return jsonError("entry_type required", 400);
    const existing = await MedicalEntry.findOne({ id: entryId, pet_id: petId }).lean();
    if (!existing) return jsonError("Medical entry not found", 404);
    if (existing.lab_result_id) {
      assertCanManageClinic(session.role);
    }
    const entry_type = existing.lab_result_id ? "lab_report" : input.entry_type;
    const r = await MedicalEntry.findOneAndUpdate(
      { id: entryId, pet_id: petId },
      {
        entry_type,
        title: input.title ?? null,
        body: input.body ?? null,
        body_weight: input.body_weight ?? null,
        dx_items: input.dx_items ?? [],
        ddx_items: input.ddx_items ?? [],
        dx_note: input.dx_note ?? null,
        ddx_note: input.ddx_note ?? null,
        administered_date: input.administered_date ?? null,
        next_due_date: input.next_due_date ?? null,
        reminder_days_before: input.reminder_days_before ?? null,
        external_file_path: input.external_file_path ?? null,
        external_file_paths: input.external_file_paths ?? [],
      },
      { new: true }
    ).lean();

    if (input.body_weight) {
      await updatePetWeight(petId, input.body_weight);
    }

    const row: MedicalRow = {
      id: r!.id,
      pet_id: r!.pet_id,
      entry_type: r!.entry_type,
      title: r!.title ?? null,
      body: r!.body ?? null,
      body_weight: r!.body_weight ?? null,
      dx_items: r!.dx_items ?? [],
      ddx_items: r!.ddx_items ?? [],
      dx_note: r!.dx_note ?? null,
      ddx_note: r!.ddx_note ?? null,
      administered_date: r!.administered_date ?? null,
      next_due_date: r!.next_due_date ?? null,
      reminder_days_before: r!.reminder_days_before ?? null,
      external_file_path: r!.external_file_path ?? null,
      external_file_paths: r!.external_file_paths ?? [],
      lab_result_id: r!.lab_result_id ?? null,
      created_at: r!.created_at,
    };
    return jsonOk(row);
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
    const { petId, entryId } = await ctx.params;
    const existing = await MedicalEntry.findOne({ id: entryId, pet_id: petId }).lean();
    if (!existing) return jsonError("Medical entry not found", 404);
    if (existing.lab_result_id) {
      assertCanManageClinic(session.role);
    }
    if (existing.lab_result_id) {
      const lrid = existing.lab_result_id;
      const lr = await LabResult.findOne({ id: lrid }).lean();
      if (lr) {
        const loId = lr.lab_order_id;
        await LabResult.deleteOne({ id: lrid });
        await LabOrder.updateOne({ id: loId }, { status: "pending" });
      }
    }
    await MedicalEntry.deleteOne({ id: entryId, pet_id: petId });
    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
