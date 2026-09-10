import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role, SessionUser } from "@/lib/types";

function normalizeRole(raw: unknown): Role | null {
  const r = String(raw ?? "");
  if (r === "superadmin" || r === "manager" || r === "vet") return r;
  return null;
}

const COOKIE = "petcare_session";

function secretKey() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
}

export type JwtPayload = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
};

export async function signSession(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const id = String(payload.id ?? "");
    const username = String(payload.username ?? "");
    const display_name = String(payload.display_name ?? "");
    const role = normalizeRole(payload.role);
    if (!id || !username || !role) {
      return null;
    }
    return { id, username, display_name, role };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const p = await verifyToken(token);
  if (!p) return null;
  return {
    id: p.id,
    username: p.username,
    display_name: p.display_name,
    role: p.role,
  };
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) {
    const e = new Error("Unauthorized");
    (e as Error & { status: number }).status = 401;
    throw e;
  }
  return s;
}
