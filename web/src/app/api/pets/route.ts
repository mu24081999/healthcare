import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { GroomingEvent, MedicalEntry, Pet } from "@/lib/models";
import type { PetInput, PetListRow, PetRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

async function nextPetCardId(): Promise<string> {
  let card = `PET-${uuid().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  while (await Pet.exists({ card_id: card })) {
    card = `PET-${uuid().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  }
  return card;
}

export async function GET(req: Request) {
  try {
    await connectDb();
    await requireSession();
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    const pets = await Pet.find(
      q
        ? {
            $or: [
              { name: { $regex: q, $options: "i" } },
              { owner_name: { $regex: q, $options: "i" } },
              { owner_phone: { $regex: q, $options: "i" } },
            ],
          }
        : {}
    )
      .sort({ name: 1 })
      .lean();
    const med = await MedicalEntry.aggregate<{ _id: string; c: number }>([
      { $group: { _id: "$pet_id", c: { $sum: 1 } } },
    ]);
    const groom = await GroomingEvent.aggregate<{ _id: string; c: number }>([
      { $group: { _id: "$pet_id", c: { $sum: 1 } } },
    ]);
    const mc = Object.fromEntries(med.map((x) => [x._id, x.c]));
    const gc = Object.fromEntries(groom.map((x) => [x._id, x.c]));
    const rows: PetListRow[] = pets.map((p) => ({
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
      deworming_status: p.deworming_status ?? null,
      owner_name: p.owner_name ?? null,
      owner_phone: p.owner_phone ?? null,
      owner_address: p.owner_address ?? null,
      owner_email: p.owner_email ?? null,
      notes: p.notes ?? null,
      created_at: p.created_at,
      updated_at: p.updated_at,
      medical_count: mc[p.id] ?? 0,
      grooming_count: gc[p.id] ?? 0,
    }));
    return jsonOk(rows);
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
    const input = (await req.json()) as { input?: PetInput };
    const i = input.input;
    if (!i?.name?.trim()) return jsonError("Name is required", 400);
    if (!i?.species?.trim()) return jsonError("Species is required", 400);
    if (!i?.owner_name?.trim()) return jsonError("Owner name is required", 400);
    if (!i?.owner_phone?.trim()) return jsonError("Owner phone is required", 400);
    const now = new Date().toISOString();
    const id = uuid();
    const card_id = await nextPetCardId();
    await Pet.create({
      id,
      card_id,
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
      created_at: now,
      updated_at: now,
    });
    const p = await Pet.findOne({ id }).lean();
    const row: PetRow = {
      id: p!.id,
      card_id: p!.card_id,
      name: p!.name,
      species: p!.species ?? null,
      breed: p!.breed ?? null,
      age: p!.age ?? null,
      date_of_birth: p!.date_of_birth ?? null,
      sex: p!.sex ?? null,
      weight: p!.weight ?? null,
      vaccine_status: p!.vaccine_status ?? null,
      deworming_status: p!.deworming_status ?? null,
      owner_name: p!.owner_name ?? null,
      owner_phone: p!.owner_phone ?? null,
      owner_address: p!.owner_address ?? null,
      owner_email: p!.owner_email ?? null,
      notes: p!.notes ?? null,
      created_at: p!.created_at,
      updated_at: p!.updated_at,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
