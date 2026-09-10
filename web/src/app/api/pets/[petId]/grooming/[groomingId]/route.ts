import { requireSession } from "@/lib/auth/session";
import { connectDb, updatePetWeight } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { GroomingEvent } from "@/lib/models";
import type { GroomingInput, GroomingRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string; groomingId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId, groomingId } = await ctx.params;
    const body = (await req.json()) as { input?: GroomingInput };
    const input = body.input;
    if (!input?.service_type || !input.performed_date) {
      return jsonError("service_type and performed_date required", 400);
    }
    const r = await GroomingEvent.findOneAndUpdate(
      { id: groomingId, pet_id: petId },
      {
        service_type: input.service_type,
        body_weight: input.body_weight ?? null,
        administered_date: input.administered_date ?? null,
        next_due_date: input.next_due_date ?? null,
        reminder_days_before: input.reminder_days_before ?? null,
        performed_date: input.performed_date,
        notes: input.notes ?? null,
      },
      { new: true }
    ).lean();
    if (!r) return jsonError("Grooming entry not found", 404);

    if (input.body_weight) {
      await updatePetWeight(petId, input.body_weight);
    }

    const row: GroomingRow = {
      id: r.id,
      pet_id: r.pet_id,
      service_type: r.service_type,
      body_weight: r.body_weight ?? null,
      administered_date: r.administered_date ?? null,
      next_due_date: r.next_due_date ?? null,
      reminder_days_before: r.reminder_days_before ?? null,
      performed_date: r.performed_date,
      notes: r.notes ?? null,
      created_at: r.created_at,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId, groomingId } = await ctx.params;
    const r = await GroomingEvent.deleteOne({ id: groomingId, pet_id: petId });
    if (r.deletedCount === 0) return jsonError("Grooming entry not found", 404);
    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
