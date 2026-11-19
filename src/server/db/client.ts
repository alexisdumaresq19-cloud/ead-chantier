import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env";
import * as schema from "./schema";

// One pool per server process; kept across hot reloads in development.
const globalForDb = globalThis as unknown as { __eadSql?: ReturnType<typeof postgres> };

function connect() {
  return postgres(env.databaseUrl, {
    max: env.dev ? 10 : 5,
    idle_timeout: 20,
    // Hosted Postgres is reached through a transaction pooler, which does not
    // keep prepared statements.
    prepare: false,
  });
}

const sql = (globalForDb.__eadSql ??= connect());

export const db = drizzle(sql, { schema });
export { schema, sql };
