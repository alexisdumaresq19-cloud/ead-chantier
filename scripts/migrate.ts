/** Applies the SQL migrations in ./drizzle. Run at each deployment. */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Scripts read the same local settings as the app.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the defaults apply.
}

const url =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  "postgres://ead:ead@127.0.0.1:54329/ead";

async function main() {
  const sql = postgres(url, { max: 1, prepare: false });
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  await sql.end();
  console.log("Base de données à jour.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
