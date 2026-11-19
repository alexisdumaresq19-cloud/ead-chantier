import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { consumeInvite, currentUser, findInvite, startSession } from "@/server/auth";
import { db, schema } from "@/server/db/client";
import { badRequest, body, HttpError, route } from "@/server/http";
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
  if (invite.kind === "personal") {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, invite.userId!))
      .limit(1);
    if (!user?.active) throw expired();
    return { kind: "personal", name: user.name } satisfies InvitePreview;
  }
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, invite.projectId!))
    .limit(1);
  if (!project) throw expired();
  const me = await currentUser(request);
  return {
    kind: "project",
    projectName: project.name,
    projectNumber: project.number,
    signedInAs: me?.name ?? null,
  } satisfies InvitePreview;
});

/**
 * Accepts the invitation. A personal link signs this device in as that
 * person. A site QR code adds the person to the project: someone already
 * signed in keeps their account, someone new gives their name.
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

  if (invite.kind === "personal") {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, invite.userId!))
      .limit(1);
    if (!user?.active) throw expired();
    if (!(await consumeInvite(invite))) throw expired();
    const response = NextResponse.json({ ok: true });
    await startSession(user.id, request, response);
    return response;
  }

  const projectId = invite.projectId!;
  const me = await currentUser(request);
  const response = NextResponse.json({ ok: true, projectId });
  let userId = me?.id;
  if (!userId) {
    if (!input.name) throw badRequest("Entrez votre nom.");
    userId = newId();
    await db.insert(schema.users).values({
      id: userId,
      name: input.name,
      phone: input.phone || null,
      role: "travailleur",
      unreviewed: true,
      createdBy: invite.createdBy,
    });
    await startSession(userId, request, response);
  }
  await db.insert(schema.projectMembers).values({ projectId, userId }).onConflictDoNothing();
  await consumeInvite(invite);
  return response;
});
