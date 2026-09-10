import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabResult, LabAnalyte } from "@/lib/models";
import { assertCanManageClinic } from "@/lib/permissions";
import type { LabResultDetail, LabResultValuePatch, LabResultValueRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function toDetail(doc: {
  id: string;
  lab_order_id: string;
  pet_id: string;
  lab_test_id: string;
  created_at: string;
  notes: string | null;
  values: {
    id: string;
    analyte_name: string;
    unit: string | null;
    normal_min: number | null;
    normal_max: number | null;
    observed_value: string;
    remarks: string | null;
  }[];
}): LabResultDetail {
  const values: LabResultValueRow[] = doc.values.map((v) => ({
    id: v.id,
    analyte_name: v.analyte_name,
    unit: v.unit ?? null,
    normal_min: v.normal_min ?? null,
    normal_max: v.normal_max ?? null,
    observed_value: v.observed_value,
    remarks: v.remarks ?? null,
  }));
  return {
    id: doc.id,
    lab_order_id: doc.lab_order_id,
    pet_id: doc.pet_id,
    lab_test_id: doc.lab_test_id,
    created_at: doc.created_at,
    notes: doc.notes ?? null,
    values,
  };
}

async function sortResultValues(values: any[], labTestId: string) {
  const analytes = await LabAnalyte.find({ lab_test_id: labTestId })
    .sort({ sort_order: 1, name: 1 })
    .lean();
  const orderMap = new Map(analytes.map((a, index) => [a.id, index]));
  return [...values].sort((a, b) => {
    const idxA = orderMap.has(a.analyte_id) ? orderMap.get(a.analyte_id)! : 999999;
    const idxB = orderMap.has(b.analyte_id) ? orderMap.get(b.analyte_id)! : 999999;
    if (idxA !== idxB) return idxA - idxB;
    return a.analyte_name.localeCompare(b.analyte_name);
  });
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    await requireSession();
    const { id } = await ctx.params;
    const r = await LabResult.findOne({ id }).lean();
    if (!r) return jsonError("Result not found", 404);
    r.values = await sortResultValues(r.values, r.lab_test_id);
    return jsonOk(toDetail(r));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const { id: labResultId } = await ctx.params;
    const body = (await req.json()) as {
      values?: LabResultValuePatch[];
      notes?: string | null;
    };
    const r = await LabResult.findOne({ id: labResultId }).lean();
    if (!r) return jsonError("Lab result not found", 404);
    const vals = [...r.values];
    for (const p of body.values ?? []) {
      const idx = vals.findIndex((v) => v.id === p.id);
      if (idx < 0) return jsonError("Invalid result value row", 400);
      vals[idx] = { ...vals[idx], observed_value: p.observedValue };
    }
    await LabResult.updateOne(
      { id: labResultId },
      { values: vals, notes: body.notes ?? null }
    );
    const updated = await LabResult.findOne({ id: labResultId }).lean();
    updated!.values = await sortResultValues(updated!.values, updated!.lab_test_id);
    return jsonOk(toDetail(updated!));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

