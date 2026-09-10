import { requireSession } from "@/lib/auth/session";
import { connectDb, updatePetWeight } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { GroomingEvent } from "@/lib/models";
import type { GroomingInput, GroomingRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId } = await ctx.params;
    const rows = await GroomingEvent.find({ pet_id: petId })
      .sort({ performed_date: -1 })
      .lean();
    const out: GroomingRow[] = rows.map((g) => ({
      id: g.id,
      pet_id: g.pet_id,
      service_type: g.service_type,
      body_weight: g.body_weight ?? null,
      administered_date: g.administered_date ?? null,
      next_due_date: g.next_due_date ?? null,
      reminder_days_before: g.reminder_days_before ?? null,
      performed_date: g.performed_date,
      notes: g.notes ?? null,
      created_at: g.created_at,
    }));
    return jsonOk(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId } = await ctx.params;
    const body = (await req.json()) as { input?: GroomingInput };
    const input = body.input;
    if (!input?.service_type || !input.performed_date) {
      return jsonError("service_type and performed_date required", 400);
    }
    const id = uuid();
    const now = new Date().toISOString();
    await GroomingEvent.create({
      id,
      pet_id: petId,
      service_type: input.service_type,
      body_weight: input.body_weight ?? null,
      administered_date: input.administered_date ?? null,
      next_due_date: input.next_due_date ?? null,
      reminder_days_before: input.reminder_days_before ?? null,
      performed_date: input.performed_date,
      notes: input.notes ?? null,
      created_at: now,
    });

    if (input.body_weight) {
      await updatePetWeight(petId, input.body_weight);
    }

    const g = await GroomingEvent.findOne({ id }).lean();
    const row: GroomingRow = {
      id: g!.id,
      pet_id: g!.pet_id,
      service_type: g!.service_type,
      body_weight: g!.body_weight ?? null,
      administered_date: g!.administered_date ?? null,
      next_due_date: g!.next_due_date ?? null,
      reminder_days_before: g!.reminder_days_before ?? null,
      performed_date: g!.performed_date,
      notes: g!.notes ?? null,
      created_at: g!.created_at,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

