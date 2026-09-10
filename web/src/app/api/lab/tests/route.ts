import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabTest } from "@/lib/models";
import { assertCanManageClinic } from "@/lib/permissions";
import type { LabTestInput, LabTestRow } from "@/lib/types";
import { v4 as uuid } from "uuid";

export const runtime = "nodejs";

function toRow(t: {
  id: string;
  name: string;
  code: string | null;
  default_report_hours: number | null;
  active: number;
  created_at: string;
}): LabTestRow {
  return {
    id: t.id,
    name: t.name,
    code: t.code ?? null,
    default_report_hours: t.default_report_hours ?? null,
    active: t.active,
    created_at: t.created_at,
  };
}

export async function GET(req: Request) {
  try {
    await connectDb();
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const all = searchParams.get("all") === "1";
    if (all) {
      assertCanManageClinic(session.role);
    }
    const q = all ? {} : { active: 1 };
    const rows = await LabTest.find(q).sort({ name: 1 }).lean();
    return jsonOk(rows.map(toRow));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function POST(req: Request) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const body = (await req.json()) as { input?: LabTestInput };
    const input = body.input;
    if (!input?.name?.trim()) return jsonError("Name required", 400);
    const id = uuid();
    const now = new Date().toISOString();
    await LabTest.create({
      id,
      name: input.name.trim(),
      code: input.code ?? null,
      default_report_hours: input.default_report_hours ?? null,
      active: 1,
      created_at: now,
    });
    const t = await LabTest.findOne({ id }).lean();
    return jsonOk(toRow(t!));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
