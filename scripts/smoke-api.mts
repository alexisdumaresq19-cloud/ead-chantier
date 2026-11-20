/**
 * End-to-end check of the API against a running server: first admin, a
 * project, a PDF of plans imported and published, tiles served, a worker
 * invited by link and by QR code, what each role may not do, and what the
 * links, the QR codes and the uploads refuse.
 *
 *   BASE=http://localhost:3200 npx tsx scripts/smoke-api.mts sample.pdf
 *
 * It needs an empty database and a development server (file store on disk).
 * To check what depends on time (sessions that end, abandoned uploads), it
 * also reads and ages rows in the server's database: DATABASE_URL, from the
 * environment or .env.local.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in a test script */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import postgres from "postgres";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment or the default applies.
}

const BASE = process.env.BASE ?? "http://localhost:3200";
const pdfPath = process.argv[2];
const sql = postgres(process.env.DATABASE_URL ?? "postgres://ead:ead@127.0.0.1:54329/ead", {
  max: 1,
  prepare: false,
  onnotice: () => {},
});
const STORAGE_DIR = process.env.STORAGE_DIR ?? ".data/storage";
const DAY = 86_400_000;
const daysFromNow = (date: Date | undefined) => (date ? (date.getTime() - Date.now()) / DAY : NaN);

class Client {
  cookie = "";
  /** When the session cookie last received ends. */
  cookieExpires: Date | undefined;
  async call(method: string, path: string, body?: unknown) {
    const response = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        // As a browser does: the API refuses writes that come from another site.
        ...(method === "GET" ? {} : { origin: BASE }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = response.headers.getSetCookie?.() ?? [];
    for (const c of set)
      if (c.startsWith("ead_session=")) {
        this.cookie = c.split(";")[0];
        const expires = /expires=([^;]+)/i.exec(c)?.[1];
        this.cookieExpires = expires ? new Date(expires) : undefined;
      }
    const text = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: response.status, json, text };
  }
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${ok || detail === undefined ? "" : " → " + JSON.stringify(detail).slice(0, 300)}`,
  );
}

type Target = { url: string; headers: Record<string, string> };
/** Sends a file to an upload link, as the browser does; returns the HTTP status. */
async function sendFile(target: Target, data: BodyInit, headers: Record<string, string> = {}) {
  const response = await fetch(new URL(target.url, BASE), {
    method: "PUT",
    headers: { ...target.headers, ...headers },
    body: data,
  });
  return response.status;
}
const bytes = (length: number) => new Uint8Array(length).fill(7);
const sessionOf = async (userId: string) =>
  (
    await sql`select id, expires_at, last_seen_at from sessions
              where user_id = ${userId} order by created_at desc limit 1`
  )[0];

let admin = new Client();
const anon = new Client();

let r = await anon.call("GET", "/api/me");
check("anonymous /api/me is 401", r.status === 401, r.json);
r = await anon.call("GET", "/api/projects");
check("anonymous cannot list projects", r.status === 401);
r = await anon.call("GET", "/api/nothing-here");
check(
  "unknown API path is a JSON 404",
  r.status === 404 && r.json?.error?.code === "not_found",
  r.text.slice(0, 80),
);

const page = await fetch(BASE + "/i/un-lien");
check(
  "pages forbid framing by other sites, type sniffing and leaking their address",
  page.headers.get("content-security-policy") === "frame-ancestors 'self'" &&
    page.headers.get("x-frame-options") === "SAMEORIGIN" &&
    page.headers.get("x-content-type-options") === "nosniff" &&
    page.headers.get("referrer-policy") === "same-origin",
  Object.fromEntries(page.headers),
);
const answer = await fetch(BASE + "/api/me");
check(
  "API answers are never kept by a cache",
  answer.headers.get("cache-control") === "private, no-store" &&
    answer.headers.get("x-frame-options") === "SAMEORIGIN",
  answer.headers.get("cache-control"),
);
check("the server does not name its software", !page.headers.has("x-powered-by"));

r = await admin.call("GET", "/api/setup");
if (r.json?.needed) {
  r = await admin.call("POST", "/api/setup", { code: "wrong", name: "Bureau EAD" });
  check(
    "setup refuses a wrong code",
    r.status === 403 && /Code de démarrage invalide/.test(r.json?.error?.message),
    r.json,
  );
  // Two people with the right code at the same moment: one account, not two.
  const rival = new Client();
  const [first, second] = await Promise.all([
    admin.call("POST", "/api/setup", { code: "dev", name: "Bureau EAD" }),
    rival.call("POST", "/api/setup", { code: "dev", name: "Bureau EAD (en double)" }),
  ]);
  check(
    "setup creates the first admin, once, even when asked twice at the same time",
    [first.status, second.status].sort().join() === "200,403",
    [first.json, second.json],
  );
  if (second.status === 200) admin = rival;
  check("the first admin is signed in", !!admin.cookie);
  r = await anon.call("POST", "/api/setup", { code: "dev", name: "Intrus" });
  check("setup cannot be used twice", r.status === 403);
  const wrong = await anon.call("POST", "/api/setup", { code: "wrong", name: "Intrus" });
  check(
    "once done, setup answers the same whatever the code",
    wrong.status === 403 && wrong.text === r.text && /déjà configurée/.test(r.json?.error?.message),
    [r.json, wrong.json],
  );
  r = await admin.call("GET", "/api/users");
  check("there is exactly one account", r.json?.length === 1, r.json);
} else {
  console.log("(setup already done: this script needs a fresh database)");
  process.exit(1);
}
r = await admin.call("GET", "/api/me");
check("admin is signed in", r.json?.role === "admin", r.json);
const adminId = r.json.id;
const [known] = await sql`select id from users where id = ${adminId}`;
check("the script reads the server's own database (DATABASE_URL)", !!known);

r = await admin.call("POST", "/api/projects", {
  name: "Réfection rue Principale (exemple)",
  number: "2026-014",
  city: "Gaspé",
  client: "Ville de Gaspé",
});
check("project created", r.status === 200 && !!r.json?.id, r.json);
const projectId = r.json.id;
r = await admin.call("POST", "/api/projects", { name: "Autre projet (exemple)" });
const otherProjectId = r.json.id;

// People: a foreman by personal link, a worker by QR code.
r = await admin.call("POST", "/api/users", {
  name: "Marc Contremaître",
  role: "contremaitre",
  projectIds: [projectId],
});
check(
  "foreman created with an invitation link",
  r.status === 200 && /\/i\//.test(r.json?.invite?.url ?? ""),
  r.json,
);
const foremanId = r.json.id;
const foremanToken = r.json.invite.url.split("/i/")[1];
const foreman = new Client();
r = await foreman.call("GET", `/api/invites/${foremanToken}`);
check(
  "invitation preview shows the name",
  r.json?.kind === "personal" &&
    r.json?.name === "Marc Contremaître" &&
    r.json?.signedInAs === null,
  r.json,
);
r = await foreman.call("POST", `/api/invites/${foremanToken}`, {});
check("invitation link signs the device in", r.status === 200 && !!foreman.cookie, r.json);
check(
  "a personal link's session lasts (400 days, renewed by use)",
  Math.abs(daysFromNow(foreman.cookieExpires) - 400) < 0.01,
  foreman.cookieExpires,
);
r = await anon.call("POST", `/api/invites/${foremanToken}`, {});
check("an invitation link works only once", r.status === 410, r.json);
r = await foreman.call("GET", "/api/projects");
check("foreman sees only his project", r.json?.length === 1 && r.json[0].id === projectId, r.json);
r = await foreman.call("GET", `/api/projects/${otherProjectId}`);
check("foreman cannot open another project", r.status === 404);
r = await foreman.call("POST", "/api/projects", { name: "Pas permis" });
check("foreman cannot create a project", r.status === 403);
r = await foreman.call("GET", "/api/users");
check("foreman cannot list everyone", r.status === 403);

// Someone else's personal link on a device that is signed in.
r = await admin.call("POST", "/api/users", {
  name: "Paul Travailleur",
  role: "travailleur",
  projectIds: [otherProjectId],
});
const paulToken = r.json.invite.url.split("/i/")[1];
r = await foreman.call("GET", `/api/invites/${paulToken}`);
check(
  "the preview of someone else's link says who is signed in on the device",
  r.json?.name === "Paul Travailleur" && r.json?.signedInAs === "Marc Contremaître",
  r.json,
);
r = await foreman.call("POST", `/api/invites/${paulToken}`, {});
check(
  "someone else's link is refused on a signed-in device, naming who is signed in",
  r.status === 409 && /sous le nom de Marc Contremaître/.test(r.json?.error?.message),
  r.json,
);
r = await foreman.call("GET", "/api/me");
check("the device keeps its account", r.json?.name === "Marc Contremaître", r.json);
r = await anon.call("GET", `/api/invites/${paulToken}`);
check("the refused link was not used up", r.status === 200 && r.json?.signedInAs === null, r.json);
const paul = new Client();
r = await paul.call("POST", `/api/invites/${paulToken}`, {});
check("its owner still gets in with it", r.status === 200 && !!paul.cookie, r.json);

// The same person opening a new link of their own: the old session ends.
r = await admin.call("POST", `/api/users/${foremanId}/invite`);
const renewedToken = r.json.url.split("/i/")[1];
const replaced = new Client();
replaced.cookie = foreman.cookie;
r = await foreman.call("GET", `/api/invites/${renewedToken}`);
check("one's own new link warns about nobody", r.json?.signedInAs === null, r.json);
r = await foreman.call("POST", `/api/invites/${renewedToken}`, {});
check(
  "one's own new link gives a new session",
  r.status === 200 && foreman.cookie !== replaced.cookie,
  r.json,
);
r = await replaced.call("GET", "/api/me");
check("and ends the session it replaces", r.status === 401, r.json);
r = await foreman.call("GET", "/api/me");
check("the foreman is still signed in", r.json?.name === "Marc Contremaître", r.json);

r = await foreman.call("POST", `/api/projects/${projectId}/qr`);
check("foreman gets a site QR link", r.status === 200 && /\/j\//.test(r.json?.url ?? ""), r.json);
const qrToken = r.json.url.split("/j/")[1];
const worker = new Client();
r = await worker.call("GET", `/api/invites/${qrToken}`);
check(
  "QR preview shows the project",
  r.json?.kind === "project" && r.json?.projectNumber === "2026-014",
  r.json,
);
check(
  "the preview tells someone new that the code lets them join",
  r.json?.access === "join" && r.json?.projectId === null && r.json?.signedInAs === null,
  r.json,
);
const usesOf = async (token: string) => {
  const hash = createHash("sha256").update(token).digest("base64url");
  const [row] = await sql`select uses, revoked_at from invites where token_hash = ${hash}`;
  return row as { uses: number; revoked_at: Date | null };
};
r = await worker.call("POST", `/api/invites/${qrToken}`, {});
check("QR join needs a name", r.status === 400, r.json);
// A name the database cannot store used to take a place and create nobody.
r = await worker.call("POST", `/api/invites/${qrToken}`, { name: "Luc\u0000Travailleur" });
check(
  "a name with a control character is refused, in French, and takes no place of the code",
  r.status === 400 &&
    r.json?.error?.message === "Ce nom contient des caractères non permis. Retapez-le." &&
    !worker.cookie &&
    (await usesOf(qrToken)).uses === 0,
  { status: r.status, json: r.json, ...(await usesOf(qrToken)) },
);
r = await worker.call("POST", `/api/invites/${qrToken}`, { name: "  Luc\t Travailleur\n" });
check("worker joins with the QR code", r.status === 200 && !!worker.cookie, r.json);
r = await worker.call("GET", "/api/projects");
check("worker sees the project", r.json?.length === 1, r.json);
r = await worker.call("POST", "/api/uploads", {
  projectId,
  kind: "plan",
  filename: "x.pdf",
  contentType: "application/pdf",
  size: 10,
});
check("worker cannot upload plans", r.status === 403, r.json);
r = await admin.call("GET", "/api/users");
const luc = r.json.find((u: any) => u.name === "Luc Travailleur");
check(
  "office sees the new worker as unreviewed, the name tidied as typed",
  luc?.unreviewed === true && luc?.deviceCount === 1,
  r.json.map((u: any) => u.name),
);

// A QR-code session ends by itself until someone confirms the person.
let session = await sessionOf(luc.id);
check(
  "a QR-code session ends 7 days after the scan (the row and the cookie)",
  Math.abs(daysFromNow(session.expires_at) - 7) < 0.01 &&
    Math.abs(daysFromNow(worker.cookieExpires) - 7) < 0.01,
  { row: session.expires_at, cookie: worker.cookieExpires },
);
await sql`update sessions set last_seen_at = now() - interval '7 hours' where id = ${session.id}`;
r = await worker.call("GET", "/api/me");
let later = await sessionOf(luc.id);
check(
  "using the app notes the visit but does not push that end back while unreviewed",
  r.status === 200 &&
    later.expires_at.getTime() === session.expires_at.getTime() &&
    Date.now() - later.last_seen_at.getTime() < 60_000,
  later,
);
check(
  "and the cookie /api/me sends again ends with the session, not 400 days later",
  Math.abs(worker.cookieExpires!.getTime() - later.expires_at.getTime()) < 1000,
  { cookie: worker.cookieExpires, session: later.expires_at },
);
const foremanSession = await sessionOf(foremanId);
await sql`update sessions set last_seen_at = now() - interval '7 hours',
          expires_at = now() + interval '100 days' where id = ${foremanSession.id}`;
r = await foreman.call("GET", "/api/me");
check(
  "while a confirmed person's session is renewed by use",
  Math.abs(daysFromNow((await sessionOf(foremanId)).expires_at) - 400) < 0.01,
);
r = await admin.call("PATCH", `/api/users/${luc.id}`, { unreviewed: false });
r = await worker.call("GET", "/api/me");
later = await sessionOf(luc.id);
check(
  "once the office has confirmed the person, the next request renews the session, cookie too",
  r.status === 200 &&
    Math.abs(daysFromNow(later.expires_at) - 400) < 0.01 &&
    Math.abs(daysFromNow(worker.cookieExpires) - 400) < 0.01,
  { session: later.expires_at, cookie: worker.cookieExpires },
);
const passing = new Client();
r = await passing.call("POST", `/api/invites/${qrToken}`, { name: "Zoé De Passage" });
const zoeId = (await passing.call("GET", "/api/me")).json.id;
session = await sessionOf(zoeId);
await sql`update sessions set last_seen_at = now() - interval '7 hours',
          expires_at = now() - interval '1 second' where id = ${session.id}`;
r = await passing.call("GET", "/api/me");
check("an unconfirmed person is signed out when the 7 days are over", r.status === 401, r.json);

// A personal link sent to someone still unconfirmed gives the same 7 days, not 400.
r = await admin.call("POST", `/api/users/${zoeId}/invite`);
r = await passing.call("POST", `/api/invites/${r.json.url.split("/i/")[1]}`, {});
check(
  "a personal link does not turn an unconfirmed person's 7 days into 400",
  r.status === 200 && Math.abs(daysFromNow(passing.cookieExpires) - 7) < 0.01,
  passing.cookieExpires,
);

// The code is for workers: nobody already in takes a place or gains anything.
r = await admin.call("POST", `/api/invites/${qrToken}`, {});
check("the office opens a QR code", r.status === 200 && r.json?.projectId === projectId, r.json);
r = await admin.call("GET", "/api/users");
check(
  "without being put on the project's list",
  r.json.find((u: any) => u.id === adminId)?.projectIds.length === 0,
);
r = await foreman.call("POST", `/api/invites/${qrToken}`, {});
check("the project's foreman opens it", r.status === 200 && r.json?.projectId === projectId);
r = await worker.call("POST", `/api/invites/${qrToken}`, {});
check("a worker already on the project opens it", r.status === 200, r.json);
const [{ uses }] = await sql`select uses from invites where kind = 'project' and revoked_at is null
                             and project_id = ${projectId}`;
check("none of them used one of the code's places", uses === 2, uses);
r = await admin.call("GET", `/api/invites/${qrToken}`);
const memberPreview = await worker.call("GET", `/api/invites/${qrToken}`);
check(
  "the preview tells the office and the project's people that the project just opens",
  r.json?.access === "open" &&
    r.json?.projectId === projectId &&
    memberPreview.json?.access === "open" &&
    memberPreview.json?.projectId === projectId,
  [r.json, memberPreview.json],
);
r = await paul.call("GET", `/api/invites/${qrToken}`);
check(
  "and a worker of another project that he can join, without naming the project's id",
  r.json?.access === "join" && r.json?.projectId === null,
  r.json,
);
// Forty requests of one person at the same moment are one person.
const eager = await Promise.all(
  Array.from({ length: 40 }, () => paul.call("POST", `/api/invites/${qrToken}`, {})),
);
check(
  "a worker of another project joins with his own account, taking one place however often he asks",
  eager.every((answer) => answer.status === 200) && (await usesOf(qrToken)).uses === 3,
  { statuses: [...new Set(eager.map((answer) => answer.status))], ...(await usesOf(qrToken)) },
);
r = await paul.call("GET", "/api/projects");
check("and sees both projects", r.json?.length === 2, r.json);

// A foreman is put on a project by the office, never by a QR code.
r = await admin.call("POST", "/api/users", {
  name: "Anne Contremaître",
  role: "contremaitre",
  projectIds: [otherProjectId],
});
const anneId = r.json.id;
const anne = new Client();
await anne.call("POST", `/api/invites/${r.json.invite.url.split("/i/")[1]}`, {});
r = await anne.call("GET", `/api/invites/${qrToken}`);
check(
  "the preview tells a foreman of another project that the code is not for her",
  r.status === 200 && r.json?.access === "refused" && r.json?.projectId === null,
  r.json,
);
r = await anne.call("POST", `/api/invites/${qrToken}`, {});
check(
  "a foreman of another project is refused by the QR code",
  r.status === 403 && /Le code QR sert aux travailleurs/.test(r.json?.error?.message),
  r.json,
);
r = await anne.call("GET", `/api/projects/${projectId}`);
check("and stays out of the project", r.status === 404, r.json);

// An archived project: its members read it, only the office changes it, nobody joins.
r = await admin.call("POST", `/api/projects/${otherProjectId}/qr`);
const officeQr = r.json.url.split("/j/")[1];
r = await anne.call("POST", `/api/projects/${otherProjectId}/qr`);
let anneQr = r.json.url.split("/j/")[1];
const announce = (client: Client, kind: string, size = 10, type = "application/pdf") =>
  client.call("POST", "/api/uploads", {
    projectId: otherProjectId,
    kind,
    filename: kind === "photo" ? "essai.jpg" : "essai.pdf",
    contentType: kind === "photo" ? "image/jpeg" : type,
    size,
  });
r = await admin.call("PATCH", `/api/projects/${otherProjectId}`, { status: "archive" });
check("the office archives a project", r.json?.status === "archive", r.json);
for (const [who, token] of [
  ["the office's", officeQr],
  ["a foreman's", anneQr],
] as const) {
  r = await anon.call("GET", `/api/invites/${token}`);
  const preview = r.status;
  r = await anon.call("POST", `/api/invites/${token}`, { name: "Trop Tard" });
  check(
    `${who} QR code of an archived project is an expired link`,
    preview === 410 && r.status === 410,
    {
      preview,
      accept: r.status,
    },
  );
}
for (const kind of ["plan", "document"]) {
  r = await announce(anne, kind);
  check(
    `a foreman cannot send a ${kind} to an archived project`,
    r.status === 403 && /archivé/.test(r.json?.error?.message),
    r.json,
  );
}
r = await announce(paul, "photo");
check(
  "a worker cannot send a photo to an archived project",
  r.status === 403 && /archivé/.test(r.json?.error?.message),
  r.json,
);
r = await announce(admin, "document");
check("the office still can", r.status === 200, r.json);
r = await anne.call("GET", `/api/projects/${otherProjectId}`);
const plans = await paul.call("GET", `/api/projects/${otherProjectId}/plans`);
check("its members still read it", r.status === 200 && plans.status === 200);
await admin.call("PATCH", `/api/projects/${otherProjectId}`, { status: "actif" });
r = await anon.call("GET", `/api/invites/${anneQr}`);
check(
  "a code tried while the project was archived stays dead when the project reopens",
  r.status === 410 && (await usesOf(anneQr)).revoked_at !== null,
  r.json,
);
r = await anne.call("POST", `/api/projects/${otherProjectId}/qr`);
anneQr = r.json.url.split("/j/")[1];
r = await anon.call("GET", `/api/invites/${anneQr}`);
check("a reopened project admits again, with a new code", r.status === 200, r.json);

// The upload link holds the sender to what was announced, and writes once.
const photo = (size: number) =>
  worker.call("POST", "/api/uploads", {
    projectId,
    kind: "photo",
    filename: "essai.jpg",
    contentType: "image/jpeg",
    size,
  });
r = await photo(10);
check("a worker announces a photo", r.status === 200 && !!r.json?.target?.url, r.json);
let ticket = r.json;
check(
  "a file larger than announced is refused",
  (await sendFile(ticket.target, bytes(3000))) === 413,
);
// 20 MB sent without saying how long: a server that read it all would store it.
let sent = 0;
const stream = await fetch(new URL(ticket.target.url, BASE), {
  method: "PUT",
  headers: ticket.target.headers,
  body: new ReadableStream({
    pull(controller) {
      if (sent++ < 20_000) controller.enqueue(new Uint8Array(1000));
      else controller.close();
    },
  }),
  duplex: "half",
} as RequestInit).then(
  (response) => response.status,
  () => "connection closed",
);
check(
  "also when it hides its length: reading stops at the announced size",
  stream === 413 || stream === "connection closed",
  stream,
);
check(
  "a file of another type than announced is refused",
  (await sendFile(ticket.target, bytes(10), { "content-type": "text/html" })) === 415,
);
check(
  "a link altered to allow more is refused",
  (await sendFile(
    { ...ticket.target, url: ticket.target.url.replace("z=10", "z=3000") },
    bytes(3000),
  )) === 403,
);
r = await worker.call("POST", `/api/uploads/${ticket.uploadId}/complete`);
check(
  "none of it was stored",
  r.status === 400 && /pas arrivé/.test(r.json?.error?.message),
  r.json,
);
check("the announced file is accepted", (await sendFile(ticket.target, bytes(10))) === 200);
r = await worker.call("POST", `/api/uploads/${ticket.uploadId}/complete`);
check("and confirmed", r.status === 200, r.json);
check(
  "the link cannot replace the confirmed file",
  (await sendFile(ticket.target, bytes(10))) === 409,
);

// A file that is not the announced one is deleted when the upload is confirmed.
r = await photo(2000);
ticket = r.json;
const folder = `${STORAGE_DIR}/private/u/${ticket.uploadId}`;
check(
  "a shorter file gets in",
  (await sendFile(ticket.target, bytes(1999))) === 200 && existsSync(folder),
);
r = await worker.call("POST", `/api/uploads/${ticket.uploadId}/complete`);
check(
  "confirming it is refused",
  r.status === 400 && /incomplet/.test(r.json?.error?.message),
  r.json,
);
check("and the file is deleted at once", !existsSync(folder));
r = await worker.call("POST", `/api/uploads/${ticket.uploadId}/complete`);
check(
  "so there is nothing left to confirm",
  r.status === 400 && /pas arrivé/.test(r.json?.error?.message),
  r.json,
);
let [row] = await sql`select status from uploads where id = ${ticket.uploadId}`;
check(
  "its row stays, unfinished, while the link may still write (it counts against the sender)",
  row?.status === "pending",
  row,
);
// Confirmations sent together while a wrong file is there: one of them deletes it.
await sendFile(ticket.target, bytes(1999));
const together = await Promise.all(
  Array.from({ length: 12 }, () => worker.call("POST", `/api/uploads/${ticket.uploadId}/complete`)),
);
check(
  "confirmations sent together are all refused, and the wrong file is gone",
  together.every((answer) => answer.status === 400) && !existsSync(folder),
  together.map((answer) => answer.status).join(),
);
check("the right file then gets in", (await sendFile(ticket.target, bytes(2000))) === 200);
const racing = await Promise.all(
  Array.from({ length: 12 }, () => worker.call("POST", `/api/uploads/${ticket.uploadId}/complete`)),
);
check(
  "and is confirmed, however many confirmations arrive: it stays in place",
  racing.every((answer) => answer.status === 200) &&
    existsSync(folder) &&
    (await sendFile(ticket.target, bytes(2000))) === 409,
  racing.map((answer) => answer.status).join(),
);

// An unfinished upload has three hours: after that it is not confirmed, and
// its file is removed. Its row stays the day, for the daily allowance.
r = await photo(2001);
ticket = r.json;
const lateFolder = `${STORAGE_DIR}/private/u/${ticket.uploadId}`;
await sendFile(ticket.target, bytes(2001));
await sql`update uploads set created_at = now() - interval '4 hours' where id = ${ticket.uploadId}`;
r = await worker.call("POST", `/api/uploads/${ticket.uploadId}/complete`);
[row] = await sql`select storage_key from uploads where id = ${ticket.uploadId}`;
check(
  "an upload is confirmed within three hours or not at all, and its file is then removed",
  r.status === 400 &&
    /trop tardé/.test(r.json?.error?.message) &&
    row?.storage_key === `u/${ticket.uploadId}/.removed` &&
    !existsSync(lateFolder),
  { answer: r.json, row },
);

// Unfinished uploads: an allowance per person, and a clean-up after three hours.
const greedy = new Client();
await greedy.call("POST", `/api/invites/${qrToken}`, { name: "Essai Plafond" });
const greedyId = (await greedy.call("GET", "/api/me")).json.id;
const hoard = (client: Client, name: string, size = 10, kind = "photo") =>
  client.call("POST", "/api/uploads", {
    projectId: kind === "photo" ? projectId : otherProjectId,
    kind,
    filename: `${name}.${kind === "photo" ? "jpg" : "pdf"}`,
    contentType: kind === "photo" ? "image/jpeg" : "application/pdf",
    size,
  });
/** Unfinished uploads whose file may still be there (not those kept only for the day). */
const pendingOf = async (userId: string) =>
  (
    await sql`select count(*)::int as pending from uploads
              where created_by = ${userId} and status = 'pending'
                and storage_key <> 'u/' || id || '/.removed'`
  )[0].pending as number;

// A send that fails is announced again by the app: it must cost nothing.
const MB = 1024 * 1024;
const retries = [];
for (let i = 0; i < 31; i++) retries.push(await hoard(greedy, "mauvais-signal", 3 * MB));
check(
  "31 tries of the same photo are one unfinished upload, none is refused",
  retries.every((answer) => answer.status === 200) &&
    new Set(retries.map((answer) => answer.json.uploadId)).size === 1 &&
    (await pendingOf(greedyId)) === 1,
  {
    statuses: [...new Set(retries.map((answer) => answer.status))],
    pending: await pendingOf(greedyId),
  },
);
check(
  "each try gets a link that works",
  (await sendFile(retries[0].json.target, bytes(3 * MB))) === 200 &&
    (await sendFile(retries[30].json.target, bytes(3 * MB))) === 409,
);
r = await greedy.call("POST", `/api/uploads/${retries[30].json.uploadId}/complete`);
r = await hoard(greedy, "mauvais-signal", 3 * MB);
check(
  "once that photo is confirmed, the same file announced again is a new upload",
  r.status === 200 && r.json.uploadId !== retries[0].json.uploadId,
  r.json,
);
await sql`delete from uploads where created_by = ${greedyId} and status = 'pending'`;

const hoarded = await Promise.all(Array.from({ length: 35 }, (_, i) => hoard(greedy, `p${i}`)));
const accepted = hoarded.filter((answer) => answer.status === 200);
const refused = hoarded.filter((answer) => answer.status === 429);
check(
  "of 35 different uploads announced at once, 30 are accepted and 5 refused",
  accepted.length === 30 && refused.length === 5,
  hoarded.map((answer) => answer.status).join(),
);
check(
  "the refusal says why, in French (with its non-breaking space before the colon)",
  refused[0]?.json?.error?.code === "too_many_uploads" &&
    /^Trop d'envois n'ont pas abouti\. Réessayez plus tard\u00a0: /.test(
      refused[0]?.json?.error?.message,
    ),
  refused[0]?.json,
);
r = await hoard(greedy, "un-de-plus");
check("and the allowance stays used up", r.status === 429, r.json);
const kept = accepted[0].json;
await sendFile(kept.target, bytes(10));
r = await greedy.call("POST", `/api/uploads/${kept.uploadId}/complete`);
r = await hoard(greedy, "un-de-plus");
check("a finished upload makes room for the next", r.status === 200, r.json);

const tries = [];
for (let i = 0; i < 5; i++) tries.push(await hoard(anne, "plans", 450 * MB, "plan"));
check(
  "five tries of one 450 MB plan are one upload",
  tries.every((answer) => answer.status === 200) && (await pendingOf(anneId)) === 1,
  tries.map((answer) => answer.status).join(),
);
const big = await Promise.all(
  Array.from({ length: 3 }, (_, i) => hoard(anne, `plans-${i}`, 500 * MB, "plan")),
);
r = await hoard(anne, "plans-de-trop", 500 * MB, "plan");
check(
  "unfinished uploads may announce 2 GB in all: a fifth different plan waits",
  big.every((answer) => answer.status === 200) && r.status === 429,
  [...big.map((answer) => answer.status), r.status],
);

// Past their three hours, unfinished uploads no longer count and are removed.
const stale = accepted.slice(1).map((answer) => answer.json);
await sendFile(stale[0].target, bytes(10));
const staleFolder = `${STORAGE_DIR}/private/u/${stale[0].uploadId}`;
await sql`update uploads set created_at = now() - interval '4 hours'
          where created_by = ${greedyId} and status = 'pending'`;
check("(30 unfinished uploads, all past their time)", (await pendingOf(greedyId)) === 30);
r = await hoard(greedy, "apres-trois-heures");
check(
  "a person whose unfinished uploads are past their time can send again at once",
  r.status === 200,
  r.json,
);
check(
  "and those are removed on the way, a few at each upload",
  (await pendingOf(greedyId)) === 21,
  await pendingOf(greedyId),
);
for (let i = 0; i < 2; i++) await hoard(greedy, "apres-trois-heures");
const [{ keptForTheDay }] = await sql`select count(*)::int as "keptForTheDay" from uploads
  where created_by = ${greedyId} and storage_key = 'u/' || id || '/.removed'`;
check(
  "until no file is left; their rows stay the day, for the daily allowance",
  (await pendingOf(greedyId)) === 1 && !existsSync(staleFolder) && keptForTheDay === 30,
  { pending: await pendingOf(greedyId), keptForTheDay },
);

// What one person may send of each kind in a day, confirmed uploads included.
const sendWhole = async (client: Client, name: string) => {
  const announced = await hoard(client, name, 2000);
  if (announced.status !== 200) return announced.status;
  await sendFile(announced.json.target, bytes(2000));
  return (await client.call("POST", `/api/uploads/${announced.json.uploadId}/complete`)).status;
};
const whole = [];
for (let i = 0; i < 45; i++) whole.push(await sendWhole(greedy, `jour-${i}`));
check(
  "45 photos sent and confirmed in a row are accepted (far below a day's limit)",
  whole.every((status) => status === 200),
  whole.join(),
);
// The rest of a very long day, written straight to the table.
const [{ sentToday }] = await sql`select count(*)::int as "sentToday" from uploads
                                  where created_by = ${greedyId} and kind = 'photo'`;
await sql`insert into uploads (id, project_id, kind, storage_key, filename, content_type, size,
                               status, created_by, created_at)
          select 'jour-' || n, ${projectId}, 'photo', 'u/jour-' || n || '/p.jpg', 'p.jpg',
                 'image/jpeg', 2000, 'complete', ${greedyId}, now() - interval '23 hours'
          from generate_series(1, ${299 - sentToday}) as n`;
r = await hoard(greedy, "la-300e");
check("the 300th photo of a day is accepted", r.status === 200, r.json);
r = await hoard(greedy, "la-301e");
check(
  "the next is refused until tomorrow, in French, as an allowance the app waits for",
  r.status === 429 &&
    r.json?.error?.code === "too_many_uploads" &&
    /limite d'envois pour une journée/.test(r.json?.error?.message),
  r.json,
);
await sql`update uploads set created_at = now() - interval '25 hours'
          where created_by = ${greedyId} and id like 'jour-%'`;
r = await hoard(greedy, "la-301e");
check("what was sent more than a day ago no longer counts", r.status === 200, r.json);

// Plans have their own day: 6 GB, so a foreman's twelfth 500 MB plan waits.
await sql`delete from uploads where created_by = ${anneId}`;
await sql`insert into uploads (id, project_id, kind, storage_key, filename, content_type, size,
                               status, created_by, created_at)
          select 'plans-' || n, ${otherProjectId}, 'plan', 'u/plans-' || n || '/p.pdf', 'p.pdf',
                 'application/pdf', ${500 * MB}, 'complete', ${anneId}, now() - interval '5 hours'
          from generate_series(1, 11) as n`;
r = await hoard(anne, "plans-du-jour", 500 * MB, "plan");
check("a foreman's plans of the day may reach 6 GB", r.status === 200, r.json);
r = await hoard(anne, "plans-de-trop", 400 * MB, "plan");
check(
  "and no more",
  r.status === 429 && /limite d'envois pour une journée/.test(r.json?.error?.message),
  r.json,
);
r = await anne.call("POST", "/api/uploads", {
  projectId: otherProjectId,
  kind: "photo",
  filename: "photo-du-jour.jpg",
  contentType: "image/jpeg",
  size: 2000,
});
check("which leaves the photos of the day alone", r.status === 200, r.json);

// The office loads whole projects: five times a person's day, and no more.
const [{ officeToday }] = await sql`select
  (select count(*) from uploads where created_by = ${adminId} and kind = 'photo'
     and created_at > now() - interval '1 day')::int
  + (select count(*) from photos where created_by = ${adminId}
     and created_at > now() - interval '1 day')::int as "officeToday"`;
await sql`insert into uploads (id, project_id, kind, storage_key, filename, content_type, size,
                               status, created_by, created_at)
          select 'bureau-' || n, ${projectId}, 'photo', 'u/bureau-' || n || '/p.jpg', 'p.jpg',
                 'image/jpeg', 2000, 'complete', ${adminId}, now() - interval '1 hour'
          from generate_series(1, ${1499 - officeToday}) as n`;
r = await hoard(admin, "le-bureau-charge-un-projet");
check("the office may send 1500 photos in a day, five times a person's", r.status === 200, r.json);
r = await hoard(admin, "le-bureau-en-envoie-trop");
check(
  "and no more",
  r.status === 429 &&
    r.json?.error?.message ===
      "Vous avez atteint la limite d'envois pour une journée. Réessayez demain.",
  r.json,
);
await sql`delete from uploads where id like 'bureau-%' or id like 'jour-%' or id like 'plans-%'`;

// A confirmed upload that nothing used is removed after a day, file and row.
const unused = await sendWhole(greedy, "jamais-utilisee");
const [unusedRow] = await sql`select id from uploads where created_by = ${greedyId}
                              and filename = 'jamais-utilisee.jpg'`;
const unusedFolder = `${STORAGE_DIR}/private/u/${unusedRow?.id}`;
await sql`update uploads set created_at = now() - interval '25 hours' where id = ${unusedRow?.id}`;
await hoard(greedy, "le-lendemain");
[row] = await sql`select id from uploads where id = ${unusedRow?.id}`;
check(
  "a confirmed upload nothing used is removed after a day, row and file",
  unused === 200 && !row && !existsSync(unusedFolder),
  { unused, row },
);

// A QR code is worth what its author's rights are worth today, and once
// found worthless it is ended for good.
const stands = async (token: string) =>
  (await anon.call("GET", `/api/invites/${token}`)).status === 200;
const newCode = async (client: Client) =>
  (await client.call("POST", `/api/projects/${otherProjectId}/qr`)).json.url.split("/j/")[1];
check("a foreman's QR code works", await stands(anneQr));
await admin.call("DELETE", `/api/projects/${otherProjectId}/members/${anneId}`);
r = await anon.call("POST", `/api/invites/${anneQr}`, { name: "Revenant" });
check(
  "it stops working when the foreman is taken off the project",
  !(await stands(anneQr)) && r.status === 410,
  r.json,
);
r = await anne.call("POST", `/api/invites/${anneQr}`, {});
const back = await anne.call("GET", `/api/projects/${otherProjectId}`);
check("so the foreman cannot use it to come back", r.status === 410 && back.status === 404, [
  r.json,
  back.json,
]);
await admin.call("POST", `/api/projects/${otherProjectId}/members`, { userIds: [anneId] });
check(
  "put back on the project by the office, the foreman's old code stays dead",
  !(await stands(anneQr)) && (await usesOf(anneQr)).revoked_at !== null,
  await usesOf(anneQr),
);
anneQr = await newCode(anne);
check("and the foreman shows a new one", await stands(anneQr));
await admin.call("PATCH", `/api/users/${anneId}`, { role: "travailleur" });
check("it stops when the foreman becomes a worker", !(await stands(anneQr)));
await admin.call("PATCH", `/api/users/${anneId}`, { role: "contremaitre" });
check("and stays dead when she is a foreman again", !(await stands(anneQr)));
anneQr = await newCode(anne);
await admin.call("PATCH", `/api/users/${anneId}`, { active: false });
r = await anon.call("POST", `/api/invites/${anneQr}`, { name: "Revenant" });
check(
  "it stops when the foreman is deactivated",
  !(await stands(anneQr)) && r.status === 410,
  r.json,
);
await admin.call("PATCH", `/api/users/${anneId}`, { active: true });
r = await anon.call("POST", `/api/invites/${anneQr}`, { name: "Revenant" });
check(
  "and stays dead when she is reactivated the same day",
  !(await stands(anneQr)) && r.status === 410,
  r.json,
);
await admin.call("PATCH", `/api/users/${anneId}`, { active: false });
check(
  "the office's own code for that project stands all the while",
  await stands(await newCode(admin)),
);

// A QR code has 40 places, however many people scan it at the same moment.
r = await admin.call("POST", "/api/projects", { name: "Grand chantier (exemple)" });
const crowdedId = r.json.id;
r = await admin.call("POST", `/api/projects/${crowdedId}/qr`);
const crowdToken = r.json.url.split("/j/")[1];
const crowd = await Promise.all(
  Array.from({ length: 45 }, async (_, i) => {
    const client = new Client();
    const answer = await client.call("POST", `/api/invites/${crowdToken}`, {
      name: `Équipe ${i + 1}`,
    });
    return { ...answer, cookie: client.cookie };
  }),
);
r = await admin.call("GET", `/api/projects/${crowdedId}/members`);
check(
  "of 45 people scanning a QR code at once, 40 get in and 5 are told the code is used up",
  crowd.filter((answer) => answer.status === 200).length === 40 &&
    crowd.filter((answer) => answer.status === 410).length === 5 &&
    r.json?.length === 40,
  { statuses: crowd.map((answer) => answer.status).join(), members: r.json?.length },
);
r = await anon.call("GET", `/api/invites/${crowdToken}`);
const lateJoin = await anon.call("POST", `/api/invites/${crowdToken}`, { name: "Trop Tard" });
check(
  "then the code tells anyone new that it has no place left, preview and acceptance",
  [r, lateJoin].every(
    (answer) =>
      answer.status === 410 &&
      answer.json?.error?.code === "invite_full" &&
      answer.json?.error?.message ===
        "Toutes les places de ce code QR sont prises. Demandez un nouveau code à votre contremaître.",
  ),
  [r.json, lateJoin.json],
);
r = await paul.call("GET", `/api/invites/${crowdToken}`);
const paulJoin = await paul.call("POST", `/api/invites/${crowdToken}`, {});
const paulProject = await paul.call("GET", `/api/projects/${crowdedId}`);
check(
  "also for a worker with an account who is not on the project",
  r.json?.error?.code === "invite_full" &&
    paulJoin.json?.error?.code === "invite_full" &&
    paulProject.status === 404,
  [r.status, paulJoin.status, paulProject.status],
);
const crowdMember = new Client();
crowdMember.cookie = crowd.find((answer) => answer.status === 200)!.cookie;
const full = [];
for (const client of [admin, crowdMember]) {
  full.push(await client.call("GET", `/api/invites/${crowdToken}`));
  full.push(await client.call("POST", `/api/invites/${crowdToken}`, {}));
}
check(
  "the office and the people already on the project still open it with the full code",
  full.every((answer) => answer.status === 200 && answer.json?.projectId === crowdedId) &&
    (await usesOf(crowdToken)).uses === 40,
  full.map((answer) => answer.status).join(),
);

// Plans.
if (pdfPath) {
  const pdf = readFileSync(pdfPath);
  r = await foreman.call("POST", "/api/uploads", {
    projectId,
    kind: "plan",
    filename: "Plans civils.pdf",
    contentType: "text/html",
    size: pdf.length,
  });
  check("upload refuses a wrong type", r.status === 400, r.json);
  r = await foreman.call("POST", "/api/uploads", {
    projectId,
    kind: "plan",
    filename: "Plans civils — émis pour construction.pdf",
    contentType: "application/pdf",
    size: pdf.length,
  });
  check("upload ticket", r.status === 200 && !!r.json?.target?.url, r.json);
  const { uploadId, target } = r.json;
  r = await foreman.call("POST", `/api/uploads/${uploadId}/complete`);
  check("cannot confirm a file that did not arrive", r.status === 400, r.json);
  const put = await fetch(new URL(target.url, BASE), {
    method: "PUT",
    headers: target.headers,
    body: pdf,
  });
  check("file sent to storage", put.ok, put.status);
  r = await foreman.call("POST", `/api/uploads/${uploadId}/complete`);
  check("upload confirmed", r.status === 200, r.json);
  check("the link cannot replace the confirmed PDF", (await sendFile(target, pdf)) === 409);
  r = await worker.call("POST", `/api/projects/${projectId}/plan-imports`, { uploadId });
  check("worker cannot start an import", r.status === 403, r.json);

  const t0 = Date.now();
  r = await foreman.call("POST", `/api/projects/${projectId}/plan-imports`, {
    uploadId,
    revisionLabel: "0",
    issuedOn: "2026-10-01",
  });
  check("import started", r.status === 200 && !!r.json?.id, r.json);
  const importId = r.json.id;
  let imp: any;
  for (;;) {
    await new Promise((res) => setTimeout(res, 1500));
    imp = (await foreman.call("GET", `/api/plan-imports/${importId}`)).json;
    const ready = imp.pages?.filter((p: any) => p.status === "ready").length ?? 0;
    process.stdout.write(`\r     ${imp.status} ${ready}/${imp.pageCount ?? "?"} `);
    if (imp.status === "review" || imp.status === "failed" || Date.now() - t0 > 180_000) break;
  }
  console.log();
  check(
    `import ready for review in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    imp.status === "review" && imp.pages.every((p: any) => p.status === "ready"),
    imp.error,
  );
  console.log(
    "     suggested:",
    imp.pages.map((p: any) => `${p.draftNumber} | ${p.draftTitle}`).join("\n                "),
  );
  r = await worker.call("GET", `/api/projects/${projectId}/plans`);
  check("nothing is visible before publication", r.json?.sheets?.length === 0, r.json);
  r = await foreman.call("PATCH", `/api/plan-imports/${importId}`, {
    pages: [{ id: imp.pages[0].id, draftSkip: true }],
  });
  check("a page can be left out", r.json?.pages?.[0]?.draftSkip === true);
  r = await foreman.call("POST", `/api/plan-imports/${importId}/publish`);
  check(
    "import published",
    r.status === 200 && r.json?.sheetIds?.length === imp.pages.length - 1,
    r.json,
  );

  r = await worker.call("GET", `/api/projects/${projectId}/plans`);
  const sheets = r.json?.sheets ?? [];
  check("worker sees the published sheets", sheets.length === imp.pages.length - 1, r.json);
  const tiles = sheets[0].current.tiles;
  console.log("     tiles:", JSON.stringify(tiles));
  const top = await fetch(new URL(`${tiles.url}/${tiles.minLevel}/0_0.webp`, BASE));
  check(
    "lowest level tile is served, cached forever",
    top.ok && /immutable/.test(top.headers.get("cache-control") ?? ""),
    top.status,
  );
  const full = await fetch(new URL(`${tiles.url}/${tiles.maxLevel}/0_0.webp`, BASE));
  check(
    "full-size tile is served",
    full.ok && full.headers.get("content-type") === "image/webp",
    full.status,
  );
  const thumb = await fetch(new URL(sheets[0].current.thumbUrl, BASE));
  check("thumbnail is served", thumb.ok);
  r = await worker.call("GET", `/api/sheets/${sheets[1].id}`);
  check(
    "sheet detail has neighbours",
    r.json?.previousId === sheets[0].id && r.json?.nextId === sheets[2].id,
    r.json,
  );
  r = await worker.call("GET", `/api/projects/${projectId}/plans/search?q=regard`);
  check(
    "search finds words drawn on the plans",
    r.json?.some?.((hit: any) => hit.excerpt),
    r.json?.slice?.(0, 2),
  );
  r = await worker.call("GET", `/api/projects/${projectId}/plans/search?q=C-201`);
  check("search finds a sheet by number", r.json?.[0]?.number === "C-201", r.json?.slice?.(0, 1));
  r = await worker.call("PATCH", `/api/sheets/${sheets[0].id}`, { title: "piraté" });
  check("worker cannot rename a sheet", r.status === 403);

  // A second import of the same set becomes revisions of the same sheets.
  r = await foreman.call("POST", "/api/uploads", {
    projectId,
    kind: "plan",
    filename: "Plans civils rév 1.pdf",
    contentType: "application/pdf",
    size: pdf.length,
  });
  const second = r.json;
  await fetch(new URL(second.target.url, BASE), {
    method: "PUT",
    headers: second.target.headers,
    body: pdf,
  });
  await foreman.call("POST", `/api/uploads/${second.uploadId}/complete`);
  r = await foreman.call("POST", `/api/projects/${projectId}/plan-imports`, {
    uploadId: second.uploadId,
    revisionLabel: "1",
  });
  const secondId = r.json.id;
  for (let i = 0; i < 120; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    imp = (await foreman.call("GET", `/api/plan-imports/${secondId}`)).json;
    if (imp.status === "review" || imp.status === "failed") break;
  }
  const matched = imp.pages.filter((p: any) => p.draftSheetId).length;
  check("re-import matches existing sheets by number", matched === sheets.length, {
    matched,
    of: imp.pages.length,
  });
  r = await foreman.call("POST", `/api/plan-imports/${secondId}/publish`);
  check("second import published", r.status === 200, r.json);
  r = await worker.call("GET", `/api/sheets/${sheets[0].id}`);
  check(
    "sheet now has two revisions, the new one current",
    r.json?.revisions?.length === 2 && r.json?.current?.label === "1",
    { n: r.json?.revisions?.length, label: r.json?.current?.label },
  );
  r = await worker.call("GET", `/api/projects/${projectId}/plans`);
  check(
    "sheet count is unchanged after a revision",
    r.json?.sheets?.length === sheets.length + 1,
    r.json?.sheets?.length,
  );
}

// Access is cut at once.
r = await admin.call("PATCH", `/api/users/${luc.id}`, { active: false });
r = await worker.call("GET", "/api/me");
check("a deactivated worker is signed out", r.status === 401);
r = await admin.call("PATCH", `/api/users/${(await admin.call("GET", "/api/me")).json.id}`, {
  role: "travailleur",
});
check("the last admin cannot demote themself", r.status === 400, r.json);
r = await foreman.call("POST", "/api/logout");
r = await foreman.call("GET", "/api/me");
check("logout ends the session", r.status === 401);

await sql.end();
console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
