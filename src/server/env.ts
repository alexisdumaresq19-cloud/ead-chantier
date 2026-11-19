// Server settings, read once. Development has working defaults; production
// must set them (see .env.example).

const dev = process.env.NODE_ENV !== "production";

function required(name: string, devDefault?: string): string {
  const value = process.env[name] ?? (dev ? devDefault : undefined);
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

export const env = {
  dev,
  get databaseUrl() {
    // POSTGRES_URL is what the Vercel database integrations set.
    return (
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      required("DATABASE_URL", "postgres://ead:ead@127.0.0.1:54329/ead")
    );
  },
  get appSecret() {
    return required("APP_SECRET", "dev-secret-not-for-production");
  },
  get storageDriver(): "fs" | "supabase" {
    const explicit = process.env.STORAGE_DRIVER;
    if (explicit === "fs" || explicit === "supabase") return explicit;
    return process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "fs";
  },
  get storageDir() {
    return process.env.STORAGE_DIR ?? ".data/storage";
  },
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** Lets the very first administrator in (see /api/setup). */
  get setupCode() {
    return process.env.SETUP_CODE ?? (dev ? "dev" : undefined);
  },
};
