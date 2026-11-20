import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isProjectMember } from "@/server/access";
import {
  consumeInvite,
  currentUser,
  endSession,
  findInvite,
  inviteIsFull,
  openSession,
  setSessionCookie,
  UNREVIEWED_SESSION_DAYS,
  type SessionUser,
} from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, forbidden, HttpError, route } from "@/server/http";
import { newId } from "@/server/ids";
import type { InvitePreview } from "@/shared/api";

const expired = () =>
  new HttpError(
    410,
    "invite_expired",
    "Ce lien n'est plus valide. Demandez-en un nouveau au bureau ou à votre contremaître.",
  );

/**
 * What a site's QR code does for someone who is signed in. The code is for
 * workers: whoever already has access keeps what they have ("open": a member
 * of the project, and the office, which sees every project and is on no
 * project's list), a worker joins ("join"), and a foreman who is not on the
 * project is refused, since only the office decides which foreman manages
 * which project.
 */
async function codeAccess(
  me: SessionUser,
  projectId: string,
): Promise<"open" | "join" | "refused"> {
  if (me.role === "admin" || (await isProjectMember(me.id, projectId))) return "open";
  return me.role === "travailleur" ? "join" : "refused";
}

/** What the link opens, shown before the person accepts. Uses nothing up. */
export const GET = route<{ token: string }>(async (request, { token }) => {
  const invite = await findInvite(token);
  if (!invite) throw expired();
  const me = await currentUser(request);
  if (invite.kind === "personal") {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, invite.userId!))
      .limit(1);
    if (!user?.active) throw expired();
    return {
      kind: "personal",
      name: user.name,
      signedInAs: me && me.id !== user.id ? me.name : null,
    } satisfies InvitePreview;
  }
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, invite.projectId!))
    .limit(1);
  if (!project) throw expired();
  const access = me ? await codeAccess(me, project.id) : "join";
  // A code with no place left admits nobody new. It still opens the project
  // for those who already have access.
  if (access === "join" && inviteIsFull(invite)) throw expired();
  return {
    kind: "project",
    projectName: project.name,
    projectNumber: project.number,
    signedInAs: me?.name ?? null,
    access,
    projectId: access === "open" ? project.id : null,
  } satisfies InvitePreview;
});

/**
 * A line of text as people type or paste it: runs of spaces, tabs and line
 * breaks become one space. Any other control character is refused here,
 * before an invitation is touched (the database would refuse a NUL, after a
 * place of the code had been taken).
 */
const line = (max: number) =>
  z
    .string()
    .transform((text) => text.replace(/\s+/gu, " ").trim())
    .pipe(
      z
        .string()
        .max(max)
        .regex(/^\P{Cc}*$/u, "caractères non permis"),
    );

/**
 * Accepts the invitation. A personal link signs this device in as that
 * person, unless someone else is signed in on it. A site QR code puts a
 * worker on the project: a worker already signed in keeps their account,
 * someone new gives their name and stays "unreviewed" until the office or the
 * project's foreman has confirmed them.
 *
 * Whatever an invitation gives is written in one transaction with the use it
 * takes: a failure half way gives the use back and leaves no account, no
 * membership and no session behind. The cookie is given after the commit.
 */
export const POST = route<{ token: string }>(async (request, { token }) => {
  const input = await body(
    request,
    z.object({
      name: line(80)
        .refine((name) => name.length >= 2, "au moins 2 caractères")
        .optional(),
      phone: line(30).optional(),
    }),
  );
  const invite = await findInvite(token);
  if (!invite) throw expired();
  const me = await currentUser(request);

  if (invite.kind === "personal") {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, invite.userId!))
      .limit(1);
    if (!user?.active) throw expired();
    // Never swap the account of a device behind its owner's back: the person
    // signed in here signs out first. Said before the link is used up, so it
    // still works afterwards.
    if (me && me.id !== user.id)
      throw new HttpError(
        409,
        "signed_in_as_other",
        `Cet appareil est déjà connecté sous le nom de ${me.name}. Déconnectez-vous avant d'ouvrir ce lien.`,
      );
    const session = await db.transaction(async (tx) => {
      if (!(await consumeInvite(invite, tx))) throw expired();
      // The same person opening a new link: the session it replaces ends
      // here, instead of staying open with nobody holding its cookie.
      if (me) await endSession(me.sessionId, undefined, tx);
      // A link does not confirm anyone: someone who came in by QR code and is
      // still unreviewed gets the same few days as at the scan.
      return openSession(
        user.id,
        request,
        user.unreviewed ? UNREVIEWED_SESSION_DAYS : undefined,
        tx,
      );
    });
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  }

  const projectId = invite.projectId!;
  const joined = { ok: true, projectId };

  if (me) {
    // Whoever is already in keeps what they have and takes none of the
    // code's places, even when none is left.
    const access = await codeAccess(me, projectId);
    if (access === "open") return joined;
    if (access === "refused")
      throw forbidden(
        "Le code QR sert aux travailleurs. Demandez au bureau de vous ajouter à ce projet.",
      );
    await db.transaction(async (tx) => {
      // A place is taken only by the request that puts the worker on the
      // project: requests sent together by one person take one place.
      const added = await tx
        .insert(schema.projectMembers)
        .values({ projectId, userId: me.id })
        .onConflictDoNothing()
        .returning({ userId: schema.projectMembers.userId });
      if (added.length && !(await consumeInvite(invite, tx))) throw expired();
    });
    return joined;
  }

  // Someone new. A place is taken before the account exists, in one
  // statement, so a code never lets in more people than it has places.
  if (!input.name) throw badRequest("Entrez votre nom.");
  const name = input.name;
  const session = await db.transaction(async (tx) => {
    if (!(await consumeInvite(invite, tx))) throw expired();
    const userId = newId();
    await tx.insert(schema.users).values({
      id: userId,
      name,
      phone: input.phone || null,
      role: "travailleur",
      unreviewed: true,
      createdBy: invite.createdBy,
    });
    await tx.insert(schema.projectMembers).values({ projectId, userId });
    // Until someone confirms the person, the device stays signed in for a few
    // days only (see sessionRenewal).
    return openSession(userId, request, UNREVIEWED_SESSION_DAYS, tx);
  });
  const response = NextResponse.json(joined);
  setSessionCookie(response, session.token, session.expiresAt);
  return response;
});
