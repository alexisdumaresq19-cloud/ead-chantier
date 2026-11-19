import { createHash, timingSafeEqual } from "node:crypto";

import { and, eq, gt, isNull, sql as raw } from "drizzle-orm";
import type { NextRequest, NextResponse } from "next/server";

import { canManageProject } from "@/shared/roles";

import { db, schema } from "./db/client";
import { env } from "./env";
import { forbidden, unauthorized } from "./http";
import { hashToken, newId, newToken } from "./ids";

// Sign-in without passwords. A device holds a session cookie it got by
// opening a personal invitation link or a project's QR code; the office can
// end any session. Only hashes of tokens are stored.

export const SESSION_COOKIE = "ead_session";
export const SESSION_DAYS = 400; // the longest a browser keeps a cookie
/**
 * How long a device stays signed in after scanning a site's QR code, for as
 * long as nobody has confirmed the person (users.unreviewed). Seven days
 * rather than two: someone who scans on a Friday is still in on Monday, when
 * the office looks at the new names.
 */
export const UNREVIEWED_SESSION_DAYS = 7;
const DAY = 86_400_000;

export type SessionUser = typeof schema.users.$inferSelect & { sessionId: string };

/**
 * What a request does to the session it came with, or null for nothing.
 * A visit is noted at most every six hours. It also pushes the session's end
 * back to the full length, except for someone who came in by QR code and has
 * not been confirmed: their session keeps the end it was given at the scan, so
 * access nobody approved stops by itself. Once they are confirmed, the next
 * request renews it like any other (at once if it was about to run out).
 */
export function sessionRenewal(
  session: { lastSeenAt: Date; expiresAt: Date },
  unreviewed: boolean,
  now: Date,
): { lastSeenAt: Date; expiresAt?: Date } | null {
  const seenLongAgo = now.getTime() - session.lastSeenAt.getTime() > DAY / 4;
  if (unreviewed) return seenLongAgo ? { lastSeenAt: now } : null;
  const endsSoon = session.expiresAt.getTime() - now.getTime() < UNREVIEWED_SESSION_DAYS * DAY;
  if (!seenLongAgo && !endsSoon) return null;
  return { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY) };
}

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

  const renewal = sessionRenewal(row.session, row.user.unreviewed, new Date());
  if (renewal) {
    await db.update(schema.sessions).set(renewal).where(eq(schema.sessions.id, row.session.id));
    await db
      .update(schema.users)
      .set({ lastSeenAt: renewal.lastSeenAt })
      .where(eq(schema.users.id, row.user.id));
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

/**
 * Opens a session for this device and puts its cookie on the response. It
 * lasts `days` from now; each visit then renews it, unless the person is
 * still unreviewed (see sessionRenewal).
 */
export async function startSession(
  userId: string,
  request: NextRequest,
  response: NextResponse,
  days: number = SESSION_DAYS,
) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + days * DAY);
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
 * How many people one QR code lets in: more than the largest crew that starts
 * on a site the same day, few enough that a photo of the code passed around
 * cannot fill a project with accounts. The foreman shows a fresh code for more.
 */
export const PROJECT_INVITE_MAX_USES = 40;

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

/**
 * A site's QR code: for a day, a worker who scans it joins that project, up
 * to PROJECT_INVITE_MAX_USES people. It stops working as soon as its author
 * may no longer manage the project (see findInvite).
 */
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
    maxUses: PROJECT_INVITE_MAX_USES,
    createdBy,
  });
  return { token, expiresAt };
}

export type Invite = typeof schema.invites.$inferSelect;

/**
 * The invitation behind a token, if it can still be used. Both the preview
 * and the acceptance go through here, so what is refused here is refused as
 * an expired link everywhere.
 */
export async function findInvite(token: string): Promise<Invite | null> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, hashToken(token)))
    .limit(1);
  if (!invite || invite.revokedAt || invite.expiresAt < new Date()) return null;
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return null;
  if (invite.kind === "project" && !(await projectInviteStands(invite))) return null;
  return invite;
}

/**
 * A site's code is worth what its author's rights are worth today, not what
 * they were when it was made: it stands only while the author still exists,
 * is active and may manage that project (the office, or a foreman who is
 * still a member). So taking a foreman off a project, deactivating them or
 * making them a worker ends their codes at once, with nothing to revoke. And
 * an archived project admits nobody, whoever made the code.
 */
async function projectInviteStands(invite: Invite): Promise<boolean> {
  if (!invite.projectId || !invite.createdBy) return false;
  const [row] = await db
    .select({
      status: schema.projects.status,
      role: schema.users.role,
      active: schema.users.active,
      memberId: schema.projectMembers.userId,
    })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.users.id, invite.createdBy))
    .leftJoin(
      schema.projectMembers,
      and(
        eq(schema.projectMembers.projectId, schema.projects.id),
        eq(schema.projectMembers.userId, schema.users.id),
      ),
    )
    .where(eq(schema.projects.id, invite.projectId))
    .limit(1);
  if (!row || row.status === "archive" || !row.active) return false;
  return canManageProject(row.role) && (row.role === "admin" || row.memberId !== null);
}

/**
 * Takes one use of the invitation; false if none is left. One statement
 * checks and counts, so simultaneous requests can never take more uses than
 * the invitation has, nor use it after it has expired or been replaced. Call
 * it before giving what the invitation gives.
 */
export async function consumeInvite(invite: Invite): Promise<boolean> {
  const used = await db
    .update(schema.invites)
    .set({ uses: raw`${schema.invites.uses} + 1` })
    .where(
      and(
        eq(schema.invites.id, invite.id),
        isNull(schema.invites.revokedAt),
        gt(schema.invites.expiresAt, new Date()),
        invite.maxUses === null
          ? undefined
          : raw`${schema.invites.uses} < ${schema.invites.maxUses}`,
      ),
    )
    .returning({ id: schema.invites.id });
  return used.length > 0;
}

// --- First-time setup -------------------------------------------------------

/**
 * Whether this is the setup code chosen at deployment. Digests are compared
 * in constant time, so the answer's delay says nothing about the code.
 */
export function isSetupCode(given: string): boolean {
  const expected = env.setupCode;
  if (!expected) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
