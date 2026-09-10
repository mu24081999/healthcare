import { requireSession } from "@/lib/auth/session";
import { connectDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { OpdConsultation, Pet } from "@/lib/models";
import {
  startOfMonthIso,
  startOfTodayIso,
  startOfWeekIso,
  toOpdConsultationRow,
} from "@/lib/opd";
import { assertCanManageClinic } from "@/lib/permissions";
import type { OpdDashboardSummary } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    await connectDb();
    const session = await requireSession();
    assertCanManageClinic(session.role);
    const todayIso = startOfTodayIso();
    const weekIso = startOfWeekIso();
    const monthIso = startOfMonthIso();
    const isVet = session.role === "vet";
    const vetScope = isVet ? { vet_id: session.id } : {};

    const [todayCount, weekCount, monthCount] = await Promise.all([
      OpdConsultation.countDocuments({
        ...vetScope,
        created_at: { $gte: todayIso },
      }),
      OpdConsultation.countDocuments({
        ...vetScope,
        created_at: { $gte: weekIso },
      }),
      OpdConsultation.countDocuments({
        ...vetScope,
        created_at: { $gte: monthIso },
      }),
    ]);

    const nextVisitDocs = await OpdConsultation.find({
      ...vetScope,
      next_visit_at: { $ne: null, $gte: todayIso },
    })
      .sort({ next_visit_at: 1 })
      .limit(15)
      .lean();
    const petIds = [...new Set(nextVisitDocs.map((r) => String(r.pet_id)))];
    const pets = await Pet.find({ id: { $in: petIds } })
      .select("id name card_id species breed age sex weight owner_name owner_phone")
      .lean();
    const petById = Object.fromEntries(
      pets.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          card_id: p.card_id,
          species: p.species ?? null,
          breed: p.breed ?? null,
          age: p.age ?? null,
          sex: p.sex ?? null,
          weight: p.weight ?? null,
          owner_name: p.owner_name ?? null,
          owner_phone: p.owner_phone ?? null,
        },
      ])
    );

    const summary: OpdDashboardSummary = {
      checked_today: todayCount,
      checked_week: weekCount,
      checked_month: monthCount,
      next_visits: nextVisitDocs.map((d) => toOpdConsultationRow(d, petById)),
    };
    return jsonOk(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Forbidden") return jsonError(msg, 403);
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(status === 401 ? msg : "Server error", status);
  }
}
