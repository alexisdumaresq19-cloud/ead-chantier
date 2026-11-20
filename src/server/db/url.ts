// The address of the database, as the app's Postgres client can take it.

const KEPT = new Set(["sslmode", "ssl"]);

/**
 * Hosting integrations add settings of their own to the address (Supabase's
 * adds "supa=…", others "pgbouncer=true"). This client would pass them on to
 * Postgres as session settings, and Postgres refuses the ones it does not
 * know: only the encryption setting is kept.
 */
export function cleanDatabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const key of [...parsed.searchParams.keys()])
    if (!KEPT.has(key)) parsed.searchParams.delete(key);
  return parsed.toString();
}
