import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env";
import * as schema from "./schema";
import { cleanDatabaseUrl } from "./url";

// One pool per server process, opened at the first query (so that building the
// app needs no database) and kept across hot reloads in development.

const globalForDb = globalThis as unknown as { __eadSql?: ReturnType<typeof postgres> };

function connection() {
  return (globalForDb.__eadSql ??= postgres(cleanDatabaseUrl(env.databaseUrl), {
    max: env.dev ? 10 : 5,
    idle_timeout: 20,
    // Hosted Postgres is reached through a transaction pooler, which does not
    // keep prepared statements.
    prepare: false,
  }));
}

type Database = ReturnType<typeof drizzle<typeof schema>>;
let database: Database | undefined;

/** The database. Used as `db.select()…`; it connects when first used. */
export const db = new Proxy({} as Database, {
  get(_, property) {
    database ??= drizzle(connection(), { schema });
    const value = Reflect.get(database, property, database);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

/** The raw client, for the few queries written by hand: sql`select …`. */
export const sql = new Proxy((() => {}) as unknown as ReturnType<typeof postgres>, {
  apply: (_, __, args) => Reflect.apply(connection(), undefined, args),
  get(_, property) {
    const client = connection();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { schema };
