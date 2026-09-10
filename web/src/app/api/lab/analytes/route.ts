import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabAnalyte } from "@/lib/models";
import { assertCanManageClinic } from "@/lib/permissions";
import type { AnalyteInput, AnalyteRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const body = (await req.json()) as {
      labTestId?: string;
      id?: string | null;
      input?: AnalyteInput;
    };
    const { labTestId, id: existingId, input } = body;
    if (!labTestId || !input?.name) return jsonError("labTestId and input.name required", 400);
    const sort = input.sort_order ?? 0;
    if (existingId) {
      const r = await LabAnalyte.findOneAndUpdate(
        { id: existingId, lab_test_id: labTestId },
        {
          name: input.name,
          unit: input.unit ?? null,
          normal_min: input.normal_min ?? null,
          normal_max: input.normal_max ?? null,
          sort_order: sort,
          remarks: input.remarks ?? null,
        },
        { new: true }
      ).lean();
      if (!r) return jsonError("Analyte not found", 404);
      const row: AnalyteRow = {
        id: r.id,
        lab_test_id: r.lab_test_id,
        name: r.name,
        unit: r.unit ?? null,
        normal_min: r.normal_min ?? null,
        normal_max: r.normal_max ?? null,
        sort_order: r.sort_order,
        remarks: r.remarks ?? null,
      };
      return jsonOk(row);
    }
    const nid = uuid();
    await LabAnalyte.create({
      id: nid,
      lab_test_id: labTestId,
      name: input.name,
      unit: input.unit ?? null,
      normal_min: input.normal_min ?? null,
      normal_max: input.normal_max ?? null,
      sort_order: sort,
      remarks: input.remarks ?? null,
    });
    const a = await LabAnalyte.findOne({ id: nid }).lean();
    const row: AnalyteRow = {
      id: a!.id,
      lab_test_id: a!.lab_test_id,
      name: a!.name,
      unit: a!.unit ?? null,
      normal_min: a!.normal_min ?? null,
      normal_max: a!.normal_max ?? null,
      sort_order: a!.sort_order,
      remarks: a!.remarks ?? null,
    };
    return jsonOk(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
