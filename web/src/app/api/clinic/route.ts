import { NextRequest, NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { Clinic } from "@/lib/models";
import { requireSession } from "@/lib/auth/session";
import { canManageClinicConfiguration } from "@/lib/permissions";

const GLOBAL_CLINIC_ID = "global";

export async function GET() {
  await connectDb();

  let clinic = await Clinic.findOne({ id: GLOBAL_CLINIC_ID });
  if (!clinic) {
    clinic = new Clinic({
      id: GLOBAL_CLINIC_ID,
      name: "",
      email: "",
      address: "",
      phone: "",
      timing: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await clinic.save();
  }

  return NextResponse.json(clinic);
}

export async function POST(req: NextRequest) {
  await connectDb();
  const session = await requireSession();
  if (!canManageClinicConfiguration(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = await req.json();
  const now = new Date().toISOString();

  await Clinic.findOneAndUpdate(
    { id: GLOBAL_CLINIC_ID },
    {
      $set: {
        ...input,
        updated_at: now,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).then((doc) => {
    if (!doc.created_at) {
      doc.created_at = now;
      return doc.save();
    }
    return doc;
  });

  const clinic = await Clinic.findOne({ id: GLOBAL_CLINIC_ID });
  return NextResponse.json(clinic);
}
