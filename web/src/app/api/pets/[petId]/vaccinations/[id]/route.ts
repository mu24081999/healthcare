import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { Vaccination } from "@/lib/models";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string; id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId, id } = await ctx.params;
    const result = await Vaccination.findOneAndDelete({ id, pet_id: petId });
    if (!result) return jsonError("Vaccination not found", 404);
    return jsonOk({});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
