import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { User } from "@/lib/models";
import { assertSuperadmin } from "@/lib/permissions";
import type { Role, StaffUserRow } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

function normalizeStoredRole(raw: string): Role {
  if (raw === "superadmin" || raw === "manager" || raw === "vet") return raw;
  return "vet";
}

function toRow(doc: {
  id: string;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
  active?: boolean;
}): StaffUserRow {
  return {
    id: doc.id,
    username: doc.username,
    display_name: doc.display_name,
    role: normalizeStoredRole(doc.role),
    created_at: doc.created_at,
    active: doc.active !== false,
  };
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await connectDb();
    const session = await requireSession();
    assertSuperadmin(session.role);
    const { id: targetId } = await ctx.params;
    const body = (await req.json()) as { active?: boolean };
    if (typeof body.active !== "boolean") {
      return jsonError("active (boolean) is required", 400);
    }
    if (!targetId) return jsonError("User id required", 400);
    if (session.id === targetId && body.active === false) {
      return jsonError("You cannot deactivate your own account", 400);
    }
    const updated = await User.findOneAndUpdate(
      { id: targetId },
      { active: body.active },
      { new: true }
    ).lean();
    if (!updated) return jsonError("User not found", 404);
    return jsonOk(
      toRow({
        id: updated.id,
        username: updated.username,
        display_name: updated.display_name,
        role: updated.role,
        created_at: updated.created_at,
        active: updated.active as boolean | undefined,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
