import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { Hospitalization } from "@/lib/models";
import type { HospitalizationInput, HospitalizationRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectDb();
    await requireSession();
    const rows = await Hospitalization.find()
      .sort({ check_in_date: -1 })
      .lean();
    const out: HospitalizationRow[] = rows.map((h) => ({
      id: h.id,
      pet_id: h.pet_id,
      cage_number: h.cage_number,
      check_in_date: h.check_in_date,
      check_out_date: h.check_out_date ?? null,
      created_at: h.created_at,
    }));
    return jsonOk(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function POST(req: Request) {
  try {
    await connectDb();
    await requireSession();
    const body = (await req.json()) as {
      id?: string | null;
      input?: HospitalizationInput;
    };
    const input = body.input;
    if (!input?.pet_id?.trim()) return jsonError("pet_id is required", 400);
    if (!input?.cage_number?.trim())
      return jsonError("cage_number is required", 400);
    if (!input?.check_in_date?.trim())
      return jsonError("check_in_date is required", 400);

    const now = new Date().toISOString();
    if (body.id) {
      const h = await Hospitalization.findOneAndUpdate(
        { id: body.id },
        {
          pet_id: input.pet_id,
          cage_number: input.cage_number.trim(),
          check_in_date: input.check_in_date,
          check_out_date: input.check_out_date ?? null,
        },
        { new: true },
      ).lean();
      if (!h) return jsonError("Hospitalization not found", 404);
      const row: HospitalizationRow = {
        id: h.id,
        pet_id: h.pet_id,
        cage_number: h.cage_number,
        check_in_date: h.check_in_date,
        check_out_date: h.check_out_date ?? null,
        created_at: h.created_at,
      };
      return jsonOk(row);
    }

    const id = uuid();
    await Hospitalization.create({
      id,
      pet_id: input.pet_id,
      cage_number: input.cage_number.trim(),
      check_in_date: input.check_in_date,
      check_out_date: input.check_out_date ?? null,
      created_at: now,
    });
    const h = await Hospitalization.findOne({ id }).lean();
    const row: HospitalizationRow = {
      id: h!.id,
      pet_id: h!.pet_id,
      cage_number: h!.cage_number,
      check_in_date: h!.check_in_date,
      check_out_date: h!.check_out_date ?? null,
      created_at: h!.created_at,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
