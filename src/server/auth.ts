import { and, eq, gt, isNull, sql as raw } from "drizzle-orm";
import type { NextRequest, NextResponse } from "next/server";

import { db, schema } from "./db/client";
import { env } from "./env";
import { forbidden, unauthorized } from "./http";
import { hashToken, newId, newToken } from "./ids";

// Sign-in without passwords. A device holds a session cookie it got by
// opening a personal invitation link or a project's QR code; the office can
// end any session. Only hashes of tokens are stored.

export const SESSION_COOKIE = "ead_session";
const SESSION_DAYS = 400; // the longest a browser keeps a cookie
const DAY = 86_400_000;

export type SessionUser = typeof schema.users.$inferSelect & { sessionId: string };

/** The signed-in user, or null. Also notes that the device was seen today. */
export async function currentUser(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, hashToken(token)),
        gt(schema.sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row || !row.user.active) return null;

  if (Date.now() - row.session.lastSeenAt.getTime() > DAY / 4) {
    const now = new Date();
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY) })
      .where(eq(schema.sessions.id, row.session.id));
    await db.update(schema.users).set({ lastSeenAt: now }).where(eq(schema.users.id, row.user.id));
  }
  return { ...row.user, sessionId: row.session.id };
}

export async function requireUser(request: NextRequest): Promise<SessionUser> {
  const user = await currentUser(request);
  if (!user) throw unauthorized();
  return user;
}

export async function requireAdmin(request: NextRequest): Promise<SessionUser> {
  const user = await requireUser(request);
  if (user.role !== "admin") throw forbidden("Réservé au bureau.");
  return user;
}

/** Opens a session for this device and puts its cookie on the response. */
export async function startSession(userId: string, request: NextRequest, response: NextResponse) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db.insert(schema.sessions).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    label: deviceLabel(request.headers.get("user-agent") ?? ""),
    expiresAt,
  });
  await db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, userId));
  setSessionCookie(response, token, expiresAt);
}

export function setSessionCookie(response: NextResponse, token: string, expires: Date) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !env.dev,
    path: "/",
    expires,
  });
}

export async function endSession(sessionId: string, response?: NextResponse) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  response?.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** "iPhone · Safari": enough for someone to recognise their own devices. */
export function deviceLabel(userAgent: string): string {
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? /Mobile/.test(userAgent)
          ? "Téléphone Android"
          : "Tablette Android"
        : /Windows/.test(userAgent)
          ? "Ordinateur Windows"
          : /Macintosh/.test(userAgent)
            ? "Mac"
            : /Linux/.test(userAgent)
              ? "Ordinateur Linux"
              : "Appareil";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /CriOS|Chrome\//.test(userAgent)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "";
  return browser ? `${device} · ${browser}` : device;
}

// --- Invitations ------------------------------------------------------------

const PERSONAL_INVITE_DAYS = 14;
const PROJECT_INVITE_HOURS = 24;

/**
 * A link for one person. Each new link replaces the person's earlier ones, and
 * it works once: opening it signs that device in.
 */
export async function createPersonalInvite(userId: string, createdBy: string): Promise<string> {
  await db
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invites.userId, userId),
        eq(schema.invites.kind, "personal"),
        isNull(schema.invites.revokedAt),
      ),
    );
  const token = newToken();
  await db.insert(schema.invites).values({
    id: newId(),
    tokenHash: hashToken(token),
    kind: "personal",
    userId,
    expiresAt: new Date(Date.now() + PERSONAL_INVITE_DAYS * DAY),
    maxUses: 1,
    createdBy,
  });
  return token;
}

/** A site's QR code: for a day, anyone who scans it can join that project. */
export async function createProjectInvite(
  projectId: string,
  createdBy: string,
): Promise<{ token: string; expiresAt: Date }> {
  await db
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invites.projectId, projectId),
        eq(schema.invites.kind, "project"),
        eq(schema.invites.createdBy, createdBy),
        isNull(schema.invites.revokedAt),
      ),
    );
  const token = newToken();
  const expiresAt = new Date(Date.now() + PROJECT_INVITE_HOURS * 3_600_000);
  await db.insert(schema.invites).values({
    id: newId(),
    tokenHash: hashToken(token),
    kind: "project",
    projectId,
    expiresAt,
    createdBy,
  });
  return { token, expiresAt };
}

export type Invite = typeof schema.invites.$inferSelect;

/** The invitation behind a token, if it can still be used. */
export async function findInvite(token: string): Promise<Invite | null> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, hashToken(token)))
    .limit(1);
  if (!invite || invite.revokedAt || invite.expiresAt < new Date()) return null;
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return null;
  return invite;
}

/** Counts a use; false if someone else took the last one in the meantime. */
export async function consumeInvite(invite: Invite): Promise<boolean> {
  const used = await db
    .update(schema.invites)
    .set({ uses: raw`${schema.invites.uses} + 1` })
    .where(
      and(
        eq(schema.invites.id, invite.id),
        isNull(schema.invites.revokedAt),
        invite.maxUses === null ? undefined : raw`${schema.invites.uses} < ${invite.maxUses}`,
      ),
    )
    .returning({ id: schema.invites.id });
  return used.length > 0;
}
