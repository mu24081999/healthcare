import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { OpdRequest, Pet } from "@/lib/models";
import { toOpdRequestRow } from "@/lib/opd";
import type { OpdRequestRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    if (session.role !== "vet" && session.role !== "manager" && session.role !== "superadmin") {
      return jsonError("Forbidden", 403);
    }
    const { id } = await ctx.params;
    const request = await OpdRequest.findOne({ id }).lean();
    if (!request) return jsonError("OPD request not found", 404);
    if (request.status !== "completed") return jsonError("Only completed cases can be reopened", 409);

    const updated = await OpdRequest.findOneAndUpdate(
      { id },
      { status: "pending", completed_at: null },
      { new: true }
    ).lean();
    if (!updated) return jsonError("Could not reopen OPD request", 500);

    const pet = await Pet.findOne({ id: updated.pet_id })
      .select("id name card_id species breed age date_of_birth sex weight owner_name owner_phone")
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
    const row: OpdRequestRow = toOpdRequestRow(updated, petById);
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
