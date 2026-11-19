import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { isProjectMember } from "@/server/access";
import {
  consumeInvite,
  currentUser,
  endSession,
  findInvite,
  startSession,
  UNREVIEWED_SESSION_DAYS,
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
  return {
    kind: "project",
    projectName: project.name,
    projectNumber: project.number,
    signedInAs: me?.name ?? null,
  } satisfies InvitePreview;
});

/**
 * Accepts the invitation. A personal link signs this device in as that
 * person, unless someone else is signed in on it. A site QR code puts a
 * worker on the project: a worker already signed in keeps their account,
 * someone new gives their name and stays "unreviewed" until the office or the
 * project's foreman has confirmed them.
 */
export const POST = route<{ token: string }>(async (request, { token }) => {
  const input = await body(
    request,
    z.object({
      name: z.string().trim().min(2).max(80).optional(),
      phone: z.string().trim().max(30).optional(),
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
    if (!(await consumeInvite(invite))) throw expired();
    // The same person opening a new link: the session it replaces ends here,
    // instead of staying open with nobody holding its cookie.
    if (me) await endSession(me.sessionId);
    const response = NextResponse.json({ ok: true });
    // A link does not confirm anyone: someone who came in by QR code and is
    // still unreviewed gets the same few days as at the scan.
    await startSession(
      user.id,
      request,
      response,
      user.unreviewed ? UNREVIEWED_SESSION_DAYS : undefined,
    );
    return response;
  }

  const projectId = invite.projectId!;
  const joined = { ok: true, projectId };
  const add = (userId: string) =>
    db.insert(schema.projectMembers).values({ projectId, userId }).onConflictDoNothing();

  // The code is for workers. Whoever is already in keeps what they have and
  // takes none of the code's places.
  if (me) {
    // The office sees every project and is on no project's list.
    if (me.role === "admin") return joined;
    if (await isProjectMember(me.id, projectId)) return joined;
    // Only the office decides which foreman manages which project.
    if (me.role !== "travailleur")
      throw forbidden(
        "Le code QR sert aux travailleurs. Demandez au bureau de vous ajouter à ce projet.",
      );
    if (!(await consumeInvite(invite))) throw expired();
    await add(me.id);
    return joined;
  }

  // Someone new. A place is taken before the account exists, in one
  // statement, so a code never lets in more people than it has places.
  if (!input.name) throw badRequest("Entrez votre nom.");
  if (!(await consumeInvite(invite))) throw expired();
  const userId = newId();
  await db.insert(schema.users).values({
    id: userId,
    name: input.name,
    phone: input.phone || null,
    role: "travailleur",
    unreviewed: true,
    createdBy: invite.createdBy,
  });
  await add(userId);
  const response = NextResponse.json(joined);
  // Until someone confirms the person, the device stays signed in for a few
  // days only (see sessionRenewal).
  await startSession(userId, request, response, UNREVIEWED_SESSION_DAYS);
  return response;
});
