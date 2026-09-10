import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });
import { seedIfEmpty } from "../src/lib/seed";

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("Set MONGODB_URI in .env or environment");
    process.exit(1);
  }
  await seedIfEmpty();
  console.log("Seed complete (skipped if users already exist).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
