import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import {
  LabAnalyte,
  LabOrder,
  LabResult,
  MedicalEntry,
  Pet,
  LabTest,
} from "@/lib/models";
import type {
  LabResultDetail,
  LabResultSummaryRow,
  LabResultValueInput,
  LabResultValueRow,
} from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await connectDb();
    await requireSession();
    const searchParams = new URL(req.url).searchParams;
    const petId = searchParams.get("petId");
    const labTestId = searchParams.get("labTestId");

    if (petId && labTestId) {
      const results = await LabResult.find({
        pet_id: petId,
        lab_test_id: labTestId,
      })
        .sort({ created_at: 1 })
        .lean();

      const analytes = await LabAnalyte.find({ lab_test_id: labTestId })
        .sort({ sort_order: 1, name: 1 })
        .lean();
      const orderMap = new Map(analytes.map((a, index) => [a.id, index]));
      for (const r of results) {
        if (r.values) {
          r.values.sort((a: any, b: any) => {
            const idxA = orderMap.has(a.analyte_id) ? orderMap.get(a.analyte_id)! : 999999;
            const idxB = orderMap.has(b.analyte_id) ? orderMap.get(b.analyte_id)! : 999999;
            if (idxA !== idxB) return idxA - idxB;
            return a.analyte_name.localeCompare(b.analyte_name);
          });
        }
      }
      return jsonOk(results);
    }

    const results = await LabResult.find({}).sort({ created_at: -1 }).lean();
    const petIds = [...new Set(results.map((r) => r.pet_id))];
    const testIds = [...new Set(results.map((r) => r.lab_test_id))];
    const [pets, tests] = await Promise.all([
      Pet.find({ id: { $in: petIds } }).lean(),
      LabTest.find({ id: { $in: testIds } }).lean(),
    ]);
    const pMap = Object.fromEntries(pets.map((p) => [p.id, p.name]));
    const tMap = Object.fromEntries(tests.map((t) => [t.id, t.name]));
    const out: LabResultSummaryRow[] = results.map((r) => ({
      id: r.id,
      pet_id: r.pet_id,
      pet_name: pMap[r.pet_id] ?? "",
      lab_test_id: r.lab_test_id,
      test_name: tMap[r.lab_test_id] ?? "",
      created_at: r.created_at,
      notes: r.notes ?? null,
    }));
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
    await requireSession();
    const body = (await req.json()) as {
      labOrderId?: string;
      values?: LabResultValueInput[];
      notes?: string | null;
    };
    const { labOrderId, values, notes } = body;
    if (!labOrderId || !values?.length) {
      return jsonError("labOrderId and values required", 400);
    }
    const order = await LabOrder.findOne({ id: labOrderId }).lean();
    if (!order) return jsonError("Lab order not found", 404);
    const { pet_id, lab_test_id } = order;
    const now = new Date().toISOString();
    const resultId = uuid();
    const valueRows: LabResultValueRow[] = [];
    const embedded: {
      id: string;
      analyte_id: string;
      analyte_name: string;
      unit: string | null;
      normal_min: number | null;
      normal_max: number | null;
      observed_value: string;
      remarks: string | null;
    }[] = [];
    for (const v of values) {
      const analyte = await LabAnalyte.findOne({
        id: v.analyte_id,
        lab_test_id,
      }).lean();
      if (!analyte) return jsonError("Unknown analyte for this test", 400);
      const vid = uuid();
      valueRows.push({
        id: vid,
        analyte_name: analyte.name,
        unit: analyte.unit ?? null,
        normal_min: analyte.normal_min ?? null,
        normal_max: analyte.normal_max ?? null,
        observed_value: v.observed_value,
        remarks: analyte.remarks ?? null,
      });
      embedded.push({
        id: vid,
        analyte_id: analyte.id,
        analyte_name: analyte.name,
        unit: analyte.unit ?? null,
        normal_min: analyte.normal_min ?? null,
        normal_max: analyte.normal_max ?? null,
        observed_value: v.observed_value,
        remarks: analyte.remarks ?? null,
      });
    }
    await LabResult.create({
      id: resultId,
      lab_order_id: labOrderId,
      pet_id,
      lab_test_id,
      created_at: now,
      notes: notes ?? null,
      values: embedded,
    });
    const medId = uuid();
    const title = `Laboratory report (${now})`;
    await MedicalEntry.create({
      id: medId,
      pet_id,
      entry_type: "lab_report",
      title,
      body: null,
      external_file_path: null,
      lab_result_id: resultId,
      created_at: now,
    });
    await LabOrder.updateOne({ id: labOrderId }, { status: "completed" });
    const detail: LabResultDetail = {
      id: resultId,
      lab_order_id: labOrderId,
      pet_id,
      lab_test_id,
      created_at: now,
      notes: notes ?? null,
      values: valueRows,
    };
    return jsonOk(detail);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
