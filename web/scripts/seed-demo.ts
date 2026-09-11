import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

import { seedDemoData } from "../src/lib/seed-demo";

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("Set MONGODB_URI in .env.local or environment");
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  const result = await seedDemoData({ force });

  console.log(result.message);
  console.log("\nLogin accounts:");
  for (const u of result.users) {
    console.log(`  ${u.username} / ${u.password}  (${u.role})`);
  }
  console.log("\nDemo pets:");
  for (const p of result.pets) {
    console.log(`  ${p}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
