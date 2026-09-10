import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabOrder, LabResult } from "@/lib/models";
import type { LabOrderRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ petId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { petId } = await ctx.params;
    const rows = await LabOrder.find({ pet_id: petId }).sort({ created_at: -1 }).lean();
    const orderIds = rows.map((o) => o.id);
    const results = await LabResult.find({ lab_order_id: { $in: orderIds } }).lean();
    const resultByOrderId = Object.fromEntries(results.map((r) => [r.lab_order_id, r.id]));
    const out: LabOrderRow[] = rows.map((o) => ({
      id: o.id,
      pet_id: o.pet_id,
      lab_test_id: o.lab_test_id,
      receipt_number: o.receipt_number ?? null,
      tentative_report_at: o.tentative_report_at ?? null,
      status: o.status,
      created_at: o.created_at,
      lab_result_id: resultByOrderId[o.id] ?? null,
    }));
    return jsonOk(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
