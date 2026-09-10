import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabOrder } from "@/lib/models";
import type { LabOrderInput, LabOrderRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await connectDb();
    await requireSession();
    const body = (await req.json()) as { input?: LabOrderInput };
    const input = body.input;
    if (!input?.pet_id || !input.lab_test_id) {
      return jsonError("pet_id and lab_test_id required", 400);
    }
    const id = uuid();
    const receipt = `RCP-${uuid().split("-")[0]}`;
    const now = new Date().toISOString();
    const tent = input.tentative_report_at ?? null;
    await LabOrder.create({
      id,
      pet_id: input.pet_id,
      lab_test_id: input.lab_test_id,
      receipt_number: receipt,
      tentative_report_at: tent,
      status: "pending",
      created_at: now,
    });
    const o = await LabOrder.findOne({ id }).lean();
    const row: LabOrderRow = {
      id: o!.id,
      pet_id: o!.pet_id,
      lab_test_id: o!.lab_test_id,
      receipt_number: o!.receipt_number ?? null,
      tentative_report_at: o!.tentative_report_at ?? null,
      status: o!.status,
      created_at: o!.created_at,
      lab_result_id: null,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
