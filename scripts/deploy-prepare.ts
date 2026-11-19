/**
 * Runs before each production build (see vercel.json): brings the database
 * up to date and makes sure the storage buckets exist. Preview builds leave
 * the database alone. Without a database configured yet, it says so and lets
 * the build go on, so the first deployment can happen before the database is
 * attached.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { ensureBuckets } from "../src/server/storage/supabase";

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
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("Base de données à jour.");
  } finally {
    await sql.end();
  }
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await ensureBuckets();
    console.log("Stockage prêt.");
  } else {
    console.warn("ATTENTION : le stockage des fichiers n'est pas configuré.");
  }
  for (const name of ["APP_SECRET", "SETUP_CODE"])
    if (!process.env[name]) console.warn(`ATTENTION : la variable ${name} n'est pas définie.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
