import bcrypt from "bcryptjs";
import { setSessionCookie, signSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { User } from "@/lib/models";
import { seedIfEmpty } from "@/lib/seed";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    await connectDb();
    await seedIfEmpty();
    const body = (await req.json()) as { username?: string; password?: string };
    const username = body.username?.trim();
    if (!username || body.password == null) {
      return jsonError("Invalid username or password", 401);
    }
    const u = await User.findOne({ username }).lean();
    if (!u) return jsonError("Invalid username or password", 401);
    if (u.active === false) {
      return jsonError("This account has been deactivated", 403);
    }
    const valid = await bcrypt.compare(body.password, u.password_hash);
    if (!valid) return jsonError("Invalid username or password", 401);
    const role = u.role as Role;
    const token = await signSession({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      role,
    });
    await setSessionCookie(token);
    return jsonOk({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      role,
    });
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Server error", 500);
  }
}
