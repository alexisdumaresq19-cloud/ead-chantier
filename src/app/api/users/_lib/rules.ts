import { z } from "zod";

import { ROLES, type Role } from "@/shared/roles";

// What a person's record may hold, and the rule that keeps the office from
// locking itself out. No database here, so it can be tested on its own.

const fields = {
  name: z.string().trim().min(2).max(80),
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
    unreviewed: z.boolean(),
    projectIds: fields.projectIds,
  })
  .partial();

/** Loose on purpose: it catches a forgotten "@" without refusing a real address. */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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
