import { z } from "zod";

import { ROLES, type Role } from "@/shared/roles";

// What a person's record may hold, and the rule that keeps the office from
// locking itself out. No database here, so it can be tested on its own.

const fields = {
  // A name too short passes here and is refused by personProblem(), in words
  // for the office: a validation error would name the field in English.
  name: z.string().trim().max(80),
  role: z.enum(ROLES),
  title: z.string().trim().max(80),
  phone: z.string().trim().max(30),
  email: z.string().trim().max(120),
  projectIds: z.array(z.string().max(40)).max(500),
};

export const newPerson = z.object({
  name: fields.name,
  role: fields.role,
  title: fields.title.nullish(),
  phone: fields.phone.nullish(),
  email: fields.email.nullish(),
  projectIds: fields.projectIds.default([]),
});

/** Only the keys that are sent change; an empty text or null clears a detail. */
export const personChange = z
  .object({
    name: fields.name,
    role: fields.role,
    title: fields.title.nullable(),
    phone: fields.phone.nullable(),
    email: fields.email.nullable(),
    active: z.boolean(),
    // Confirming is one way: nobody is put back under the seven-day limit.
    unreviewed: z.literal(false),
    projectIds: fields.projectIds,
  })
  .partial();

/** Loose on purpose: it catches a forgotten "@" without refusing a real address. */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** What is wrong with the details typed, said to the office; null when they can be saved. */
export function personProblem(details: { name?: string; email?: string | null }): string | null {
  if (details.name !== undefined && details.name.length < 2)
    return "Entrez le prénom et le nom de la personne.";
  if (details.email && !looksLikeEmail(details.email))
    return "Vérifiez le courriel : il semble incomplet.";
  return null;
}

/**
 * Why a change would cost the office its access, or null when it may go
 * ahead. Nobody takes away their own office access, and one active office
 * account must always remain: without it nobody could invite anyone again.
 */
export function officeLockout({
  target,
  change,
  actorId,
  otherActiveAdmins,
}: {
  target: { id: string; role: Role; active: boolean };
  change: { role?: Role; active?: boolean };
  actorId: string;
  /** Active office accounts, the target left out. */
  otherActiveAdmins: number;
}): string | null {
  if (target.role !== "admin" || !target.active) return null;
  const demoted = change.role !== undefined && change.role !== "admin";
  const deactivated = change.active === false;
  if (!demoted && !deactivated) return null;
  if (target.id === actorId) {
    return "Vous ne pouvez pas retirer votre propre accès au bureau. Demandez à une autre personne du bureau de le faire.";
  }
  if (otherActiveAdmins < 1) return "Il doit rester au moins une personne active au bureau.";
  return null;
}

/**
 * Why a foreman may not confirm or refuse this person on their project, or
 * null when they may. It is only for someone who came in by the site's QR
 * code and that nobody has confirmed yet, on that project: the rest of a
 * person's record is the office's.
 */
export function reviewRefusal(
  target: { role: Role; active: boolean; unreviewed: boolean; onProject: boolean } | null,
): { status: 404 | 409; message: string } | null {
  if (!target || !target.onProject || !target.active || target.role !== "travailleur")
    return { status: 404, message: "Cette personne n'est pas sur ce projet." };
  if (!target.unreviewed) return { status: 409, message: "Cette personne est déjà confirmée." };
  return null;
}
