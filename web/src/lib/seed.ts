import bcrypt from "bcrypt";
import { v4 as uuid } from "uuid";
import { connectDb } from "@/lib/db";
import { User } from "@/lib/models";

export async function seedIfEmpty(): Promise<void> {
  await connectDb();
  const count = await User.countDocuments();
  if (count > 0) return;
  const now = new Date().toISOString();
  const hashS = await bcrypt.hash("superadmin", 10);
  const hashM = await bcrypt.hash("manager", 10);
  const hashV = await bcrypt.hash("vet", 10);
  await User.insertMany([
    {
      id: uuid(),
      username: "superadmin",
      password_hash: hashS,
      display_name: "Super administrator",
      role: "superadmin",
      created_at: now,
      active: true,
    },
    {
      id: uuid(),
      username: "manager",
      password_hash: hashM,
      display_name: "Clinic manager",
      role: "manager",
      created_at: now,
      active: true,
    },
    {
      id: uuid(),
      username: "vet",
      password_hash: hashV,
      display_name: "Veterinarian",
      role: "vet",
      created_at: now,
      active: true,
    },
  ]);
}
