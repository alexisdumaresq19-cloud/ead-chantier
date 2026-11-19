/**
 * End-to-end check of the API against a running server: first admin, a
 * project, a PDF of plans imported and published, tiles served, a worker
 * invited by link and by QR code, and what each role may not do.
 *
 *   BASE=http://localhost:3200 npx tsx scripts/smoke-api.mts sample.pdf
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in a test script */
import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3200";
const pdfPath = process.argv[2];

class Client {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const response = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = response.headers.getSetCookie?.() ?? [];
    for (const c of set) if (c.startsWith("ead_session=")) this.cookie = c.split(";")[0];
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

const admin = new Client();
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

r = await admin.call("GET", "/api/setup");
if (r.json?.needed) {
  r = await admin.call("POST", "/api/setup", { code: "wrong", name: "Bureau EAD" });
  check("setup refuses a wrong code", r.status === 403);
  r = await admin.call("POST", "/api/setup", { code: "dev", name: "Bureau EAD" });
  check("setup creates the first admin", r.status === 200 && !!admin.cookie, r.json);
  r = await anon.call("POST", "/api/setup", { code: "dev", name: "Intrus" });
  check("setup cannot be used twice", r.status === 403);
} else {
  console.log("(setup already done: this script needs a fresh database)");
  process.exit(1);
}
r = await admin.call("GET", "/api/me");
check("admin is signed in", r.json?.role === "admin", r.json);

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
const foremanToken = r.json.invite.url.split("/i/")[1];
const foreman = new Client();
r = await foreman.call("GET", `/api/invites/${foremanToken}`);
check(
  "invitation preview shows the name",
  r.json?.kind === "personal" && r.json?.name === "Marc Contremaître",
  r.json,
);
r = await foreman.call("POST", `/api/invites/${foremanToken}`, {});
check("invitation link signs the device in", r.status === 200 && !!foreman.cookie, r.json);
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
r = await worker.call("POST", `/api/invites/${qrToken}`, {});
check("QR join needs a name", r.status === 400, r.json);
r = await worker.call("POST", `/api/invites/${qrToken}`, { name: "Luc Travailleur" });
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
  "office sees the new worker as unreviewed",
  luc?.unreviewed === true && luc?.deviceCount === 1,
  luc,
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

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
