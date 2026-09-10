import { clearSessionCookie } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  await connectDb();
  await clearSessionCookie();
  return new Response(null, { status: 204 });
}
