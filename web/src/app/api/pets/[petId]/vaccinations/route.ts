import { requireSession } from "@/lib/auth/session";
import { connectDb, updatePetWeight } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { Vaccination } from "@/lib/models";
import type { VaccinationInput, VaccinationRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId } = await ctx.params;
    const rows = await Vaccination.find({ pet_id: petId }).lean();
    rows.sort((a, b) => {
      const ad = a.next_due_date || "\uffff";
      const bd = b.next_due_date || "\uffff";
      return ad.localeCompare(bd);
    });
    const out: VaccinationRow[] = rows.map((v) => ({
      id: v.id,
      pet_id: v.pet_id,
      vaccine_name: v.vaccine_name,
      body_weight: v.body_weight ?? null,
      administered_date: v.administered_date ?? null,
      next_due_date: v.next_due_date ?? null,
      reminder_days_before: v.reminder_days_before ?? null,
      notes: v.notes ?? null,
      created_at: v.created_at,
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
    const body = (await req.json()) as { id?: string | null; input?: VaccinationInput };
    const input = body.input;
    if (!input?.vaccine_name) return jsonError("vaccine_name required", 400);
    const now = new Date().toISOString();
    if (body.id) {
      const r = await Vaccination.findOneAndUpdate(
        { id: body.id, pet_id: petId },
        {
          vaccine_name: input.vaccine_name,
          body_weight: input.body_weight ?? null,
          administered_date: input.administered_date ?? null,
          next_due_date: input.next_due_date ?? null,
          reminder_days_before: input.reminder_days_before ?? null,
          notes: input.notes ?? null,
        },
        { new: true }
      ).lean();
      if (!r) return jsonError("Vaccination not found", 404);

      if (input.body_weight) {
        await updatePetWeight(petId, input.body_weight);
      }

      const row: VaccinationRow = {
        id: r.id,
        pet_id: r.pet_id,
        vaccine_name: r.vaccine_name,
        body_weight: r.body_weight ?? null,
        administered_date: r.administered_date ?? null,
        next_due_date: r.next_due_date ?? null,
        reminder_days_before: r.reminder_days_before ?? null,
        notes: r.notes ?? null,
        created_at: r.created_at,
      };
      return jsonOk(row);
    }
    const id = uuid();
    await Vaccination.create({
      id,
      pet_id: petId,
      vaccine_name: input.vaccine_name,
      body_weight: input.body_weight ?? null,
      administered_date: input.administered_date ?? null,
      next_due_date: input.next_due_date ?? null,
      reminder_days_before: input.reminder_days_before ?? null,
      notes: input.notes ?? null,
      created_at: now,
    });

    if (input.body_weight) {
      await updatePetWeight(petId, input.body_weight);
    }

    const v = await Vaccination.findOne({ id }).lean();
    const row: VaccinationRow = {
      id: v!.id,
      pet_id: v!.pet_id,
      vaccine_name: v!.vaccine_name,
      body_weight: v!.body_weight ?? null,
      administered_date: v!.administered_date ?? null,
      next_due_date: v!.next_due_date ?? null,
      reminder_days_before: v!.reminder_days_before ?? null,
      notes: v!.notes ?? null,
      created_at: v!.created_at,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

