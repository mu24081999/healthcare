import mongoose from "mongoose";

declare global {
  // eslint-disable-next-line no-var
  var mongooseConn: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
}

const g = globalThis as typeof globalThis & {
  mongooseConn?: { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
};

if (!g.mongooseConn) {
  g.mongooseConn = { conn: null, promise: null };
}

/** Rewrites deprecated role values still present in older databases (raw collection, no schema enum). */
async function migrateLegacyUserRoles(): Promise<void> {
  const { User } = await import("@/lib/models");
  await User.collection.updateMany({ role: "admin" }, { $set: { role: "manager" } });
  await User.collection.updateMany({ role: "attender" }, { $set: { role: "vet" } });
}

async function ensureUserActiveDefaults(): Promise<void> {
  const { User } = await import("@/lib/models");
  await User.collection.updateMany(
    { $or: [{ active: { $exists: false } }, { active: null }] },
    { $set: { active: true } }
  );
}

async function ensurePetCardIds(): Promise<void> {
  const { v4: uuid } = await import("uuid");
  const { Pet } = await import("@/lib/models");
  const missing = await Pet.find({
    $or: [{ card_id: { $exists: false } }, { card_id: null }, { card_id: "" }],
  })
    .select("id card_id")
    .lean();
  for (const p of missing) {
    let next = `PET-${uuid().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    // Prevent unique index collisions while backfilling older data.
    // eslint-disable-next-line no-await-in-loop
    while (await Pet.exists({ card_id: next })) {
      next = `PET-${uuid().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
    }
    // eslint-disable-next-line no-await-in-loop
    await Pet.updateOne({ id: p.id }, { card_id: next });
  }
}

async function ensureSuperadminUser(): Promise<void> {
  const bcrypt = await import("bcrypt");
  const { v4: uuid } = await import("uuid");
  const { User } = await import("@/lib/models");
  const exists = await User.findOne({ username: "superadmin" }).lean();
  if (exists) return;
  const now = new Date().toISOString();
  const password_hash = await bcrypt.hash("superadmin", 10);
  await User.create({
    id: uuid(),
    username: "superadmin",
    password_hash,
    display_name: "Super administrator",
    role: "superadmin",
    created_at: now,
    active: true,
  });
}

export async function updatePetWeight(petId: string, weight: string | null | undefined): Promise<void> {
  if (!weight) return;
  const w = weight.trim();
  if (!w) return;

  const { Pet } = await import("@/lib/models");
  await Pet.updateOne(
    { id: petId },
    { weight: w, updated_at: new Date().toISOString() }
  );
}

export async function connectDb(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  if (g.mongooseConn!.conn) {
    return g.mongooseConn!.conn;
  }
  if (!g.mongooseConn!.promise) {
    // Always use the single shared `petcare` database.
    g.mongooseConn!.promise = mongoose
      .connect(uri, { dbName: "petcare" })
      .then((m) => m);
  }
  g.mongooseConn!.conn = await g.mongooseConn!.promise;
  await migrateLegacyUserRoles();
  await ensureUserActiveDefaults();
  await ensurePetCardIds();
  if (process.env.SEED_ON_BOOT === "true") {
    const { seedIfEmpty } = await import("@/lib/seed");
    await seedIfEmpty();
  }
  await ensureSuperadminUser();
  return g.mongooseConn!.conn;
}
