import { getSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  await connectDb();
  const s = await getSession();
  return jsonOk(s);
}
