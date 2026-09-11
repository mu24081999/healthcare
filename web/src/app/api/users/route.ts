import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { User } from "@/lib/models";
import { assertSuperadmin } from "@/lib/permissions";
import type { CreateStaffUserInput, Role, StaffUserRow } from "@/lib/types";

export const runtime = "nodejs";

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

export async function GET() {
  try {
    await connectDb();
    const session = await requireSession();
    assertSuperadmin(session.role);
    const docs = await User.find({})
      .select("id username display_name role created_at active")
      .sort({ username: 1 })
      .lean();
    const rows: StaffUserRow[] = docs.map((d) =>
      toRow({
        id: d.id,
        username: d.username,
        display_name: d.display_name,
        role: d.role,
        created_at: d.created_at,
        active: d.active as boolean | undefined,
      })
    );
    return jsonOk(rows);
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
    assertSuperadmin(session.role);
    const body = (await req.json()) as { input?: CreateStaffUserInput };
    const input = body.input;
    const username = input?.username?.trim();
    const password = input?.password ?? "";
    const display_name = input?.display_name?.trim();
    const role = input?.role;
    if (!username || !display_name) {
      return jsonError("Username and display name are required", 400);
    }
    if (password.length < 8) {
      return jsonError("Password must be at least 8 characters", 400);
    }
    if (role !== "manager" && role !== "vet") {
      return jsonError("Role must be manager or vet", 400);
    }
    const exists = await User.findOne({ username }).lean();
    if (exists) return jsonError("That username is already taken", 409);
    const now = new Date().toISOString();
    const password_hash = await bcrypt.hash(password, 10);
    const doc = await User.create({
      id: uuid(),
      username,
      password_hash,
      display_name,
      role,
      created_at: now,
      active: true,
    });
    return jsonOk(
      toRow({
        id: doc.id,
        username: doc.username,
        display_name: doc.display_name,
        role: doc.role,
        created_at: doc.created_at,
        active: doc.active !== false,
      })
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
