import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { LabTest } from "@/lib/models";
import { assertCanManageClinic } from "@/lib/permissions";
import type { LabTestInput, LabTestRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

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

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const { id } = await ctx.params;
    const body = (await req.json()) as { input?: LabTestInput };
    const input = body.input;
    if (!input?.name?.trim()) return jsonError("Name required", 400);
    const r = await LabTest.findOneAndUpdate(
      { id },
      {
        name: input.name.trim(),
        code: input.code ?? null,
        default_report_hours: input.default_report_hours ?? null,
      },
      { new: true }
    ).lean();
    if (!r) return jsonError("Not found", 404);
    return jsonOk(toRow(r));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const { id } = await ctx.params;
    const r = await LabTest.findOneAndUpdate({ id }, { active: 0 }, { new: true }).lean();
    if (!r) return jsonError("Not found", 404);
    return new Response(null, { status: 204 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
