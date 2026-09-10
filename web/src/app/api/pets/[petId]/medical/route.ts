import { requireSession } from "@/lib/auth/session";
import { connectDb, updatePetWeight } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { MedicalEntry } from "@/lib/models";
import type { MedicalInput, MedicalRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId } = await ctx.params;
    const rows = await MedicalEntry.find({ pet_id: petId })
      .sort({ created_at: -1 })
      .lean();
    const out: MedicalRow[] = rows.map((m) => ({
      id: m.id,
      pet_id: m.pet_id,
      entry_type: m.entry_type,
      title: m.title ?? null,
      body: m.body ?? null,
      body_weight: m.body_weight ?? null,
      dx_items: m.dx_items ?? [],
      ddx_items: m.ddx_items ?? [],
      dx_note: m.dx_note ?? null,
      ddx_note: m.ddx_note ?? null,
      administered_date: m.administered_date ?? null,
      next_due_date: m.next_due_date ?? null,
      reminder_days_before: m.reminder_days_before ?? null,
      external_file_path: m.external_file_path ?? null,
      external_file_paths: m.external_file_paths ?? [],
      lab_result_id: m.lab_result_id ?? null,
      created_at: m.created_at,
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
    const body = (await req.json()) as { input?: MedicalInput };
    const input = body.input;
    if (!input?.entry_type) return jsonError("entry_type required", 400);
    const id = uuid();
    const now = new Date().toISOString();
    await MedicalEntry.create({
      id,
      pet_id: petId,
      entry_type: input.entry_type,
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
      lab_result_id: null,
      created_at: now,
    });

    if (input.body_weight) {
      await updatePetWeight(petId, input.body_weight);
    }

    const m = await MedicalEntry.findOne({ id }).lean();
    const row: MedicalRow = {
      id: m!.id,
      pet_id: m!.pet_id,
      entry_type: m!.entry_type,
      title: m!.title ?? null,
      body: m!.body ?? null,
      body_weight: m!.body_weight ?? null,
      dx_items: m!.dx_items ?? [],
      ddx_items: m!.ddx_items ?? [],
      dx_note: m!.dx_note ?? null,
      ddx_note: m!.ddx_note ?? null,
      administered_date: m!.administered_date ?? null,
      next_due_date: m!.next_due_date ?? null,
      reminder_days_before: m!.reminder_days_before ?? null,
      external_file_path: m!.external_file_path ?? null,
      external_file_paths: m!.external_file_paths ?? [],
      lab_result_id: m!.lab_result_id ?? null,
      created_at: m!.created_at,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

