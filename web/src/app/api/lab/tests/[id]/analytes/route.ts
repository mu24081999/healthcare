import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabAnalyte } from "@/lib/models";
import type { AnalyteRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { id: lab_test_id } = await ctx.params;
    const rows = await LabAnalyte.find({ lab_test_id })
      .sort({ sort_order: 1, name: 1 })
      .lean();
    const out: AnalyteRow[] = rows.map((a) => ({
      id: a.id,
      lab_test_id: a.lab_test_id,
      name: a.name,
      unit: a.unit ?? null,
      normal_min: a.normal_min ?? null,
      normal_max: a.normal_max ?? null,
      sort_order: a.sort_order,
      remarks: a.remarks ?? null,
    }));
    return jsonOk(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
