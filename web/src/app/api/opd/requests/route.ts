import { v4 as uuid } from "uuid";
import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { OpdRequest, Pet } from "@/lib/models";
import { toOpdRequestRow } from "@/lib/opd";
import { assertCanManageClinic } from "@/lib/permissions";
import type { OpdRequestRow } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await connectDb();
    await requireSession();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const filter: Record<string, string | { $in: string[] }> = {};
    if (status === "open" || !status) {
      filter.status = { $in: ["pending", "in_progress"] };
    } else if (
      status === "pending" ||
      status === "in_progress" ||
      status === "completed"
    ) {
      filter.status = status;
    }

    const requests = await OpdRequest.find(filter).sort({ created_at: -1 }).lean();
    const petIds = [...new Set(requests.map((r) => String(r.pet_id)))];
    const pets = await Pet.find({ id: { $in: petIds } })
      .select("id name card_id species breed age date_of_birth sex weight owner_name owner_phone")
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
      ])
    );
    const out: OpdRequestRow[] = requests.map((r) => toOpdRequestRow(r, petById));
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
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const body = (await req.json()) as { petId?: string };
    const petId = body.petId?.trim() ?? "";
    if (!petId) return jsonError("petId is required", 400);

    const pet = await Pet.findOne({ id: petId }).lean();
    if (!pet) return jsonError("Pet not found", 404);

    const openExisting = await OpdRequest.findOne({
      pet_id: petId,
      status: { $in: ["pending", "in_progress"] },
    }).lean();
    if (openExisting) {
      const row = toOpdRequestRow(openExisting, {
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
      });
      return jsonOk(row);
    }

    const now = new Date().toISOString();
    const id = uuid();
    await OpdRequest.create({
      id,
      pet_id: petId,
      requested_by_user_id: session.id,
      requested_by_name: session.display_name,
      status: "pending",
      assigned_vet_id: null,
      assigned_vet_name: null,
      created_at: now,
      claimed_at: null,
      completed_at: null,
    });

    const created = await OpdRequest.findOne({ id }).lean();
    if (!created) return jsonError("Could not create OPD request", 500);
    const row = toOpdRequestRow(created, {
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
    });
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
