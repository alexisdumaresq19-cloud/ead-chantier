import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  COMPANY_LIMITS as L,
  emailProblem,
  EMPTY_COMPANY_PROFILE,
  officerProblem,
  phoneProblem,
  type CompanyProfile,
  type CompanyProfileInput,
} from "@/shared/company";

import { db, schema } from "../db/client";

// The company's public contact details, one row of the app's settings (its
// value the details as JSON). The office fills them in; the privacy policy
// and the support page read them on every visit. Nothing is ever filled in
// for the office but the name: a made-up address or phone on a legal page
// would be worse than none.

const KEY = "company_profile";
const settings = schema.appSettings;

/** One line of text, trimmed, with its inner runs of spaces made one. */
const line = (max: number) =>
  z
    .string()
    .transform((text) => text.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max, `${max} caractères au plus.`));

/** An address: a few lines, each trimmed, empty ones dropped. */
const address = z
  .string()
  .transform((text) =>
    text
      .split(/\r?\n/)
      .map((one) => one.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n"),
  )
  .pipe(
    z
      .string()
      .max(L.address, `${L.address} caractères au plus.`)
      .refine((text) => text.split("\n").length <= L.addressLines, {
        message: `${L.addressLines} lignes au plus.`,
      }),
  );

const phone = line(L.phone).refine((text) => phoneProblem(text) === null, {
  message: "Ce numéro de téléphone n'est pas valide.",
});

const email = line(L.email)
  .transform((text) => text.toLowerCase())
  .refine((text) => emailProblem(text) === null, { message: "Ce courriel n'est pas valide." });

/** What the office sends. Every field must be there, empty when not known. */
export const companyProfileInput = z.object({
  name: line(L.name).pipe(z.string().min(2, "Le nom de l'entreprise est requis.")),
  address,
  phone,
  email,
  privacyOfficer: z
    .object({
      name: line(L.officerName),
      title: line(L.officerTitle),
      contact: line(L.officerContact),
    })
    .refine((officer) => officerProblem(officer) === null, {
      message: "Inscrivez aussi son nom ou son titre.",
      path: ["title"],
    }),
}) satisfies z.ZodType<CompanyProfileInput, unknown>;

/**
 * The stored JSON, read leniently: a value written by an older version, or
 * damaged, gives the details it still holds and empty ones for the rest.
 */
export function parseStoredProfile(value: string | null): CompanyProfileInput {
  const empty = EMPTY_COMPANY_PROFILE;
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: as if nothing was filled in.
  }
  const text = (schema: z.ZodType<string, unknown>, input: unknown, fallback: string) => {
    const result = schema.safeParse(typeof input === "string" ? input : fallback);
    return result.success ? result.data : fallback;
  };
  const officer =
    raw.privacyOfficer && typeof raw.privacyOfficer === "object"
      ? (raw.privacyOfficer as Record<string, unknown>)
      : {};
  const name = text(line(L.name), raw.name, empty.name);
  return {
    name: name || empty.name,
    address: text(address, raw.address, ""),
    phone: text(phone, raw.phone, ""),
    email: text(email, raw.email, ""),
    privacyOfficer: {
      name: text(line(L.officerName), officer.name, ""),
      title: text(line(L.officerTitle), officer.title, ""),
      contact: text(line(L.officerContact), officer.contact, ""),
    },
  };
}

/** The details as they stand, with who changed them last. */
export async function readCompanyProfile(): Promise<CompanyProfile> {
  const [row] = await db
    .select({
      value: settings.value,
      updatedAt: settings.updatedAt,
      author: schema.users.name,
    })
    .from(settings)
    .leftJoin(schema.users, eq(schema.users.id, settings.updatedBy))
    .where(eq(settings.key, KEY))
    .limit(1);
  if (!row) return EMPTY_COMPANY_PROFILE;
  return {
    ...parseStoredProfile(row.value),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.author ?? null,
  };
}

/** Replaces the details with what the office sent, already validated. */
export async function writeCompanyProfile(
  profile: CompanyProfileInput,
  userId: string,
  now = new Date(),
) {
  const value = JSON.stringify(profile);
  await db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: userId, updatedAt: now },
    });
}
