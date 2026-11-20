// Shapes exchanged between the app and its API (the foundation: people,
// projects, uploads). Each module adds its own file beside this one.

import type { Role } from "./roles";

export type ApiError = { error: { code: string; message: string } };

export type Me = {
  id: string;
  name: string;
  role: Role;
  title: string | null;
  /**
   * Nobody has confirmed the person yet: their access ends by itself after a
   * few days. Missing from what a device stored before it was sent.
   */
  unreviewed?: boolean;
};

/** How someone made their own account: "company_code", the company's code. */
export type JoinedWith = "company_code";

export type ProjectSummary = {
  id: string;
  number: string | null;
  name: string;
  client: string | null;
  address: string | null;
  city: string | null;
  status: "actif" | "archive";
  sheetCount: number;
  memberCount: number;
};

export type ProjectDetail = ProjectSummary & {
  description: string | null;
  latitude: string | null;
  longitude: string | null;
  documentCount: number;
  photoCount: number;
  reportCount: number;
  /**
   * Manages the project (its foreman, or the office): reads what only they
   * read, such as the daily reports. Says nothing of the project being open.
   */
  canManage: boolean;
  /**
   * May change the project's content and let people in: `canManage`, on a
   * project that is not archived (the office may, even then). Screens offer
   * adding, editing and the QR code on this; the server decides again.
   */
  canChange: boolean;
};

export type Member = {
  id: string;
  name: string;
  role: Role;
  title: string | null;
  phone: string | null;
  /** Came in by a site's QR code or the company's code; nobody has confirmed them yet. */
  unreviewed: boolean;
  /**
   * Made their own account with the company's code; null when the office or
   * a site's QR code made it. A project's list says it only of the people
   * still to confirm, to those who may confirm them. Missing means null.
   */
  joinedWith?: JoinedWith | null;
};

/** A member as GET /api/projects/:id/members gives them. */
export type TeamMember = Member & {
  /** For someone still to confirm, when their account was made (a scan of the site's code, or the company's code); null otherwise. */
  scannedAt: string | null;
};

export type Person = Member & {
  email: string | null;
  active: boolean;
  projectIds: string[];
  deviceCount: number;
  lastSeenAt: string | null;
  createdAt: string;
};

export type Device = {
  id: string;
  label: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
};

/** What an invitation link or a site QR code opens, before it is accepted. */
export type InvitePreview =
  | {
      kind: "personal";
      name: string;
      /**
       * Someone else is signed in on this device: their name. They sign out
       * before the link can be used (it is refused until then).
       */
      signedInAs: string | null;
    }
  | {
      kind: "project";
      projectName: string;
      projectNumber: string | null;
      signedInAs: string | null;
      /**
       * What the code does for whoever is looking at it. "join": it puts them
       * on the project (someone new gives their name first). "open": they
       * already have access (a member, the office), so the project just
       * opens. "refused": a foreman who is not on the project; only the
       * office adds a foreman.
       */
      access: "join" | "open" | "refused";
      /** The project to open, when `access` is "open". */
      projectId: string | null;
    };

export type InviteLink = { url: string; expiresAt: string };

export type UploadTicket = {
  uploadId: string;
  target: { url: string; method: "PUT"; headers: Record<string, string> };
};
