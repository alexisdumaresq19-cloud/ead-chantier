// Server settings, read once. Development has working defaults; production
// must set them (see .env.example).

const dev = process.env.NODE_ENV !== "production";

function required(name: string, devDefault?: string): string {
  const value = process.env[name] ?? (dev ? devDefault : undefined);
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

/**
 * The shortest SETUP_CODE production accepts. Until the office's account
 * exists, the code is all that stands between the internet and that account,
 * and nothing slows guesses down: it has to be too long to guess.
 */
export const SETUP_CODE_MIN_LENGTH = 16;

type Settings = Record<string, string | undefined>;

/**
 * Where files are kept, from the settings alone: an explicit STORAGE_DRIVER
 * wins, else Supabase as soon as its key is there, else the folder on disk.
 */
export function storageDriverFrom(settings: Settings): "fs" | "supabase" {
  const explicit = settings.STORAGE_DRIVER;
  if (explicit === "fs" || explicit === "supabase") return explicit;
  return settings.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "fs";
}

/**
 * Why a production server may not keep its files the way these settings say,
 * or null when it may. The folder on disk is the development store, served
 * by the development file route (src/app/files): production never falls back
 * to it because a setting is missing or was copied from .env.example. It has
 * to be asked for with ALLOW_FS_STORAGE=1 (the end-to-end tests do).
 */
export function productionStorageProblem(settings: Settings): string | null {
  if (storageDriverFrom(settings) === "fs") {
    if (settings.ALLOW_FS_STORAGE === "1") return null;
    return "Stockage sur disque refusé en production : définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY et retirer STORAGE_DRIVER=fs (ou ALLOW_FS_STORAGE=1 pour un serveur d'essai).";
  }
  if (!settings.SUPABASE_URL || !settings.SUPABASE_SERVICE_ROLE_KEY)
    return "Stockage Supabase incomplet : définir SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.";
  return null;
}

/**
 * What to tell whoever deploys about SETUP_CODE, or null when all is well.
 * `officeExists`: the first account has been created.
 */
export function setupCodeAdvice(code: string | undefined, officeExists: boolean): string | null {
  if (officeExists)
    return code
      ? "SETUP_CODE ne sert plus, le compte du bureau existe : retirez cette variable."
      : null;
  if (!code)
    return `SETUP_CODE n'est pas définie : le compte du bureau ne pourra pas être créé. Générez-la avec « openssl rand -base64 24 » (au moins ${SETUP_CODE_MIN_LENGTH} caractères).`;
  if (code.length < SETUP_CODE_MIN_LENGTH)
    return `SETUP_CODE compte moins de ${SETUP_CODE_MIN_LENGTH} caractères : en production elle est ignorée et le compte du bureau ne pourra pas être créé. Générez-la avec « openssl rand -base64 24 ».`;
  return null;
}

/**
 * How hard the door of account creation is held (src/server/signup/door.ts).
 * The code is eight digits: these are what make guessing it hopeless.
 */
export type SignupLimits = {
  /** Refused tries from one network address in an hour. */
  triesPerHour: number;
  /** Wrong codes from everyone in a day, against the code in force; then creation pauses. */
  wrongCodesPerDay: number;
  /** Accounts made with the code in a day, by everyone. */
  accountsPerDay: number;
};

export const SIGNUP_LIMITS: SignupLimits = {
  triesPerHour: 5,
  wrongCodesPerDay: 40,
  accountsPerDay: 30,
};

/**
 * The ceilings from the settings (a test server sets its own), each a whole
 * number from 1 to 10 000; anything else keeps the default.
 */
export function signupLimitsFrom(settings: Settings): SignupLimits {
  const read = (name: string, fallback: number) => {
    const value = Number(settings[name]);
    return Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : fallback;
  };
  return {
    triesPerHour: read("SIGNUP_TRIES_PER_HOUR", SIGNUP_LIMITS.triesPerHour),
    wrongCodesPerDay: read("SIGNUP_WRONG_CODES_PER_DAY", SIGNUP_LIMITS.wrongCodesPerDay),
    accountsPerDay: read("SIGNUP_ACCOUNTS_PER_DAY", SIGNUP_LIMITS.accountsPerDay),
  };
}

let signupLimits: SignupLimits | undefined;

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
    const problem = dev ? null : productionStorageProblem(process.env);
    if (problem) throw new Error(problem);
    return storageDriverFrom(process.env);
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
  /**
   * Lets the very first administrator in (see /api/setup). In production a
   * code that is missing or too short counts as none: setup stays closed.
   */
  get setupCode(): string | undefined {
    const code = process.env.SETUP_CODE;
    if (dev) return code ?? "dev";
    return code && code.length >= SETUP_CODE_MIN_LENGTH ? code : undefined;
  },
  /** Read once: every request of a server holds the same door. */
  get signupLimits(): SignupLimits {
    return (signupLimits ??= signupLimitsFrom(process.env));
  },
};
