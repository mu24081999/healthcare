import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { OpdCatalogItem } from "@/lib/models";
import { assertSuperadmin } from "@/lib/permissions";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    assertSuperadmin(session.role);
    const { id } = await ctx.params;
    const deleted = await OpdCatalogItem.findOneAndDelete({ id }).lean();
    if (!deleted) return jsonError("Catalog item not found", 404);
    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
