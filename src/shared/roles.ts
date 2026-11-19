// Who can do what. Three roles, from the office to the site.

export const ROLES = ["admin", "contremaitre", "travailleur"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Bureau",
  contremaitre: "Contremaître",
  travailleur: "Travailleur",
};

/** Sees every project and manages people. */
export const isAdmin = (role: Role) => role === "admin";

/** Adds plans and documents, and invites workers to their projects. */
export const canManageProject = (role: Role) => role === "admin" || role === "contremaitre";

/** Writes the daily report. */
export const canWriteReports = (role: Role) => role === "admin" || role === "contremaitre";
