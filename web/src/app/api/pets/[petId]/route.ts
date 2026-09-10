import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { Pet } from "@/lib/models";
import { assertCanManageClinic } from "@/lib/permissions";
import type { PetInput, PetRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId } = await ctx.params;
    const p = await Pet.findOne({ id: petId }).lean();
    if (!p) return jsonError("Pet not found", 404);
    const row: PetRow = {
      id: p.id,
      card_id: p.card_id,
      name: p.name,
      species: p.species ?? null,
      breed: p.breed ?? null,
      age: p.age ?? null,
      date_of_birth: p.date_of_birth ?? null,
      sex: p.sex ?? null,
      weight: p.weight ?? null,
      vaccine_status: p.vaccine_status ?? null,
      deworming_status: p.deworming_status ?? null,      owner_name: p.owner_name ?? null,
      owner_phone: p.owner_phone ?? null,
      owner_address: p.owner_address ?? null,
      owner_email: p.owner_email ?? null,
      notes: p.notes ?? null,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId } = await ctx.params;
    const input = (await req.json()) as { input?: PetInput };
    const i = input.input;
    if (!i?.name?.trim()) return jsonError("Name is required", 400);
    if (!i?.species?.trim()) return jsonError("Species is required", 400);
    if (!i?.owner_name?.trim()) return jsonError("Owner name is required", 400);
    if (!i?.owner_phone?.trim()) return jsonError("Owner phone is required", 400);
    const now = new Date().toISOString();
    const r = await Pet.findOneAndUpdate(
      { id: petId },
      {
        name: i.name.trim(),
        species: i.species ?? null,
        breed: i.breed ?? null,
        age: i.age ?? null,
        date_of_birth: i.date_of_birth ?? null,
        sex: i.sex ?? null,
        weight: i.weight ?? null,
        vaccine_status: i.vaccine_status ?? null,
        deworming_status: i.deworming_status ?? null,
        owner_name: i.owner_name ?? null,
        owner_phone: i.owner_phone ?? null,
        owner_address: i.owner_address ?? null,
        owner_email: i.owner_email ?? null,
        notes: i.notes ?? null,
        updated_at: now,
      },
      { new: true }
    ).lean();
    if (!r) return jsonError("Pet not found", 404);
    const row: PetRow = {
      id: r.id,
      card_id: r.card_id,
      name: r.name,
      species: r.species ?? null,
      breed: r.breed ?? null,
      age: r.age ?? null,
      date_of_birth: r.date_of_birth ?? null,
      sex: r.sex ?? null,
      weight: r.weight ?? null,
      vaccine_status: r.vaccine_status ?? null,
      deworming_status: r.deworming_status ?? null,
      owner_name: r.owner_name ?? null,
      owner_phone: r.owner_phone ?? null,
      owner_address: r.owner_address ?? null,
      owner_email: r.owner_email ?? null,
      notes: r.notes ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
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
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const { petId } = await ctx.params;
    const r = await Pet.findOneAndDelete({ id: petId });
    if (!r) return jsonError("Pet not found", 404);
    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
