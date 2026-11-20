// The company's public contact details, kept by the office (app_settings,
// key "company_profile"): what the privacy policy and the support page show.
//
//   GET /api/company/profile          → CompanyProfile        (office only)
//   PUT /api/company/profile          CompanyProfileInput → CompanyProfile
//
// Every text is trimmed; an empty one is a detail not filled in yet.

/** The only fact known for sure: the name the report's PDF already prints. */
export const COMPANY_NAME = "Les Entreprises Allen Dumaresq";

/** The person responsible for the protection of personal information (Québec's Law 25). */
export type PrivacyOfficer = {
  name: string;
  /** Their title in the company, e.g. "Directrice générale". */
  title: string;
  /** How to reach them, when it is not the company's own phone or email. */
  contact: string;
};

export type CompanyProfileInput = {
  name: string;
  /** The postal address, on one to three lines. */
  address: string;
  phone: string;
  email: string;
  privacyOfficer: PrivacyOfficer;
};

export type CompanyProfile = CompanyProfileInput & {
  /** When the office last changed the details; null while nobody has. */
  updatedAt: string | null;
  /** Who did, by name; null when unknown. */
  updatedBy: string | null;
};

/** The longest each detail may be: room for any real one, never a page of text. */
export const COMPANY_LIMITS = {
  name: 120,
  address: 300,
  addressLines: 3,
  phone: 40,
  email: 200,
  officerName: 120,
  officerTitle: 120,
  officerContact: 200,
} as const;

/** A profile with nothing filled in but the name. */
export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  name: COMPANY_NAME,
  address: "",
  phone: "",
  email: "",
  privacyOfficer: { name: "", title: "", contact: "" },
  updatedAt: null,
  updatedBy: null,
};

export type CompanyDetail = "address" | "phone" | "email" | "privacyOfficer";

export const COMPANY_DETAIL_LABELS: Record<CompanyDetail, string> = {
  address: "l'adresse",
  phone: "le téléphone",
  email: "le courriel",
  privacyOfficer: "la personne responsable des renseignements personnels",
};

/** What is still missing, in the order the card lists it. */
export function missingDetails(profile: CompanyProfileInput): CompanyDetail[] {
  const missing: CompanyDetail[] = [];
  if (!profile.address.trim()) missing.push("address");
  if (!profile.phone.trim()) missing.push("phone");
  if (!profile.email.trim()) missing.push("email");
  if (!profile.privacyOfficer.name.trim()) missing.push("privacyOfficer");
  return missing;
}

const PHONE = /^[+(]?\d[\d\s().-]{5,}\d(\s*(poste|p\.|ext\.?|x)\s*\d{1,6})?$/i;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** What is wrong with a phone number as typed, or null (an empty one is fine). */
export function phoneProblem(text: string): string | null {
  const value = text.trim();
  return value === "" || PHONE.test(value) ? null : "Ce numéro de téléphone n'est pas valide.";
}

/** What is wrong with an email address as typed, or null (an empty one is fine). */
export function emailProblem(text: string): string | null {
  const value = text.trim();
  return value === "" || EMAIL.test(value) ? null : "Ce courriel n'est pas valide.";
}

/** "a, b et c": a list the way it is said. */
export function frenchList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;
}

/** "tel:+14185550142" from "418 555-0142": a link the phone dials. */
export function phoneHref(phone: string): string {
  // "418 555-0142 poste 12": the extension is said, not dialled.
  const digits = (phone.split(/[a-z#,;]/i)[0] ?? "").replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(digits)) return `tel:+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `tel:+${digits}`;
  return `tel:${digits}`;
}
