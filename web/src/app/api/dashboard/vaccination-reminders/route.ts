import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { Pet, Vaccination } from "@/lib/models";
import type { VaccinationReminder } from "@/lib/types";

export const runtime = "nodejs";

function parseDue(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  const d = Date.parse(s);
  if (Number.isNaN(d)) return null;
  return new Date(d);
}

export async function GET(req: Request) {
  try {
    await connectDb();
    await requireSession();
    const { searchParams } = new URL(req.url);
    const within = Number(searchParams.get("within") ?? "30");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const rows = await Vaccination.find({
      next_due_date: { $exists: true, $nin: [null, ""] },
    }).lean();
    const petIds = [...new Set(rows.map((v) => v.pet_id))];
    const pets = await Pet.find({ id: { $in: petIds } }).lean();
    const pMap = Object.fromEntries(pets.map((p) => [p.id, p.name]));
    const out: VaccinationReminder[] = [];
    for (const v of rows) {
      if (!v.next_due_date) continue;
      const due = parseDue(v.next_due_date);
      if (!due) continue;
      due.setUTCHours(0, 0, 0, 0);
      const daysUntil = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (daysUntil >= 0 && daysUntil <= within) {
        out.push({
          pet_id: v.pet_id,
          pet_name: pMap[v.pet_id] ?? "",
          vaccine_name: v.vaccine_name,
          next_due_date: v.next_due_date,
          days_until: daysUntil,
        });
      }
    }
    out.sort((a, b) => a.days_until - b.days_until);
    return jsonOk(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
