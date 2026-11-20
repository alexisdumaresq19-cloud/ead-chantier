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

export type SessionUser = typeof schema.users.$inferSelect & {
  sessionId: string;
  /** When this device's session ends, renewal included: its cookie ends then too. */
  sessionExpiresAt: Date;
};

/**
 * The database, or a transaction of it. What signs someone in is done in
 * several steps (a link is used, an account is made, a session is opened):
 * a route runs them in one transaction, so a failure half way leaves nothing
 * behind, and passes the transaction to the functions below.
 */
export type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

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
  return {
    ...row.user,
    sessionId: row.session.id,
    sessionExpiresAt: renewal?.expiresAt ?? row.session.expiresAt,
  };
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
 * Opens a session for this device and returns what its cookie must hold. It
 * lasts `days` from now; each visit then renews it, unless the person is
 * still unreviewed (see sessionRenewal). Inside a transaction, give the
 * cookie (setSessionCookie) only once the transaction is committed.
 */
export async function openSession(
  userId: string,
  request: NextRequest,
  days: number = SESSION_DAYS,
  executor: Executor = db,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + days * DAY);
  await executor.insert(schema.sessions).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    label: deviceLabel(request.headers.get("user-agent") ?? ""),
    expiresAt,
  });
  await executor
    .update(schema.users)
    .set({ lastSeenAt: new Date() })
    .where(eq(schema.users.id, userId));
  return { token, expiresAt };
}

/** Opens a session for this device (openSession) and puts its cookie on the response. */
export async function startSession(
  userId: string,
  request: NextRequest,
  response: NextResponse,
  days: number = SESSION_DAYS,
) {
  const session = await openSession(userId, request, days);
  setSessionCookie(response, session.token, session.expiresAt);
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

export async function endSession(
  sessionId: string,
  response?: NextResponse,
  executor: Executor = db,
) {
  await executor.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
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
 * to PROJECT_INVITE_MAX_USES people. It stops working, for good, as soon as
 * it is tried while its author may no longer manage the project or while the
 * project is archived (see findInvite).
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
 *
 * A site's code that has no place left is still returned: it admits nobody
 * new (consumeInvite refuses, and the preview says so with inviteIsFull), but
 * it goes on opening the project for those who already have access to it.
 */
export async function findInvite(token: string): Promise<Invite | null> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.tokenHash, hashToken(token)))
    .limit(1);
  if (!invite || invite.revokedAt || invite.expiresAt < new Date()) return null;
  if (invite.kind === "personal") return inviteIsFull(invite) ? null : invite;
  if (await projectInviteStands(invite)) return invite;
  // Seen while it does not stand, the code is ended for good: it stays dead
  // if its author gets their rights back or the project is reopened the same
  // day. (A code nobody tried in between is not seen here: the routes that
  // take those rights away should also revoke it.)
  await db
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invites.id, invite.id), isNull(schema.invites.revokedAt)));
  return null;
}

/**
 * A line of text as people type or paste it (a name, a phone number): runs
 * of spaces, tabs and line breaks become one space. Null when any other
 * control character is left, which no one types and the database may refuse
 * (a NUL), when it holds an invisible or direction-changing character (a
 * zero-width space, a right-to-left override: a name that looks like
 * another's in the member list), or half of a character (a lone surrogate,
 * which the database would store as "�"). Such a line is refused before an
 * invitation is touched.
 */
export function typedLine(text: string): string | null {
  const line = text.replace(/\s+/gu, " ").trim();
  // Beyond control and formatting characters: the invisible "fillers" that
  // Unicode files as letters (Hangul fillers) or symbols (the blank Braille
  // cell), which make a name that reads exactly like someone else's.
  return /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\u2800]/u.test(line) ? null : line;
}

/** Whether every use of the invitation has been taken. */
export function inviteIsFull(invite: Pick<Invite, "uses" | "maxUses">): boolean {
  return invite.maxUses !== null && invite.uses >= invite.maxUses;
}

/**
 * A site's code is worth what its author's rights are worth today, not what
 * they were when it was made: it stands only while the author still exists,
 * is active and may manage that project (the office, or a foreman who is
 * still a member). So taking a foreman off a project, deactivating them or
 * making them a worker ends their codes as soon as someone tries one. And an
 * archived project admits nobody, whoever made the code.
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
 * it before giving what the invitation gives, in the same transaction
 * (`executor`): if what follows fails, the use is given back.
 */
export async function consumeInvite(invite: Invite, executor: Executor = db): Promise<boolean> {
  const used = await executor
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
