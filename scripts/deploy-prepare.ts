/**
 * Runs before each production build (see vercel.json): brings the database
 * up to date and makes sure the storage buckets exist, with their limits.
 * Preview builds leave the database alone. Without a database configured yet,
 * it says so and lets the build go on, so the first deployment can happen
 * before the database is attached. Once there is a database, a build without
 * hosted file storage fails: the app would refuse to store anything.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { productionStorageProblem, setupCodeAdvice, storageDriverFrom } from "../src/server/env";
import { ensureBuckets } from "../src/server/storage/supabase";
import { BUCKET_RULES } from "../src/server/uploads";

const production = process.env.VERCEL_ENV ? process.env.VERCEL_ENV === "production" : true;
const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;

async function main() {
  if (!production) {
    console.log("Aperçu : la base de données n'est pas modifiée.");
    return;
  }
  if (!databaseUrl) {
    console.warn(
      "ATTENTION : aucune base de données n'est configurée. L'application ne fonctionnera pas encore.",
    );
    return;
  }
  // Checked before anything is changed: the server refuses the same settings
  // when it starts (src/server/env.ts).
  const storageProblem = productionStorageProblem(process.env);
  if (storageProblem) {
    console.error(`ERREUR : déploiement arrêté. ${storageProblem}`);
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  let officeExists: boolean;
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("Base de données à jour.");
    [{ officeExists }] = await sql<
      { officeExists: boolean }[]
    >`select exists (select 1 from users) as "officeExists"`;
  } finally {
    await sql.end();
  }

  if (storageDriverFrom(process.env) === "supabase") {
    await ensureBuckets(BUCKET_RULES);
    console.log("Stockage prêt.");
  } else {
    console.warn(
      "ATTENTION : les fichiers sont gardés sur le disque du serveur (ALLOW_FS_STORAGE=1). À réserver aux essais.",
    );
  }

  if (!process.env.APP_SECRET)
    console.warn("ATTENTION : la variable APP_SECRET n'est pas définie.");
  const advice = setupCodeAdvice(process.env.SETUP_CODE, officeExists);
  if (advice) console.warn(`ATTENTION : ${advice}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
