import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, request as api, test } from "@playwright/test";
import postgres from "postgres";

import { call, contextAs, post, seed } from "./support";

// What the app refuses, checked against the production build: framing and
// caching, a link or a QR code used by the wrong person, a closed project,
// a file that is not the one announced. Each test names the weakness it
// keeps closed.

const DAY = 86_400;

test("every answer forbids framing, sniffing and caching of personal data", async ({ request }) => {
  for (const path of ["/", "/projets/x/plans", "/i/un-lien", "/api/me", "/api/nulle-part"]) {
    const { headers } = await call(request, "GET", path);
    expect(headers["content-security-policy"], path).toBe("frame-ancestors 'self'");
    expect(headers["x-frame-options"], path).toBe("SAMEORIGIN");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("same-origin");
    expect(headers["x-powered-by"], path).toBeUndefined();
    if (path.startsWith("/api/")) expect(headers["cache-control"], path).toBe("private, no-store");
  }
  // The headers of the service worker's address are still there.
  const worker = await call(request, "GET", "/sw.js");
  expect(worker.headers["service-worker-allowed"]).toBe("/");
  expect(worker.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
  expect(worker.headers["x-content-type-options"]).toBe("nosniff");
});

test("the app still loads whole, and only its own pages can frame it", async ({
  page,
  baseURL,
}) => {
  const blocked: string[] = [];
  const failures: { url: string; reason: string | undefined }[] = [];
  page.on("requestfailed", (request) => {
    blocked.push(`${request.method()} ${request.url()}`);
    failures.push({ url: request.url(), reason: request.failure()?.errorText });
  });
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text())) blocked.push(message.text());
  });
  await page.goto("/bienvenue");
  await expect(page.getByRole("heading", { name: "Bienvenue" })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      fonts: [...document.fonts].filter((font) => font.status === "loaded").length,
      images: [...document.images].every((image) => image.complete && image.naturalWidth > 0),
    };
  });
  expect(loaded.fonts).toBeGreaterThan(0);
  expect(loaded.images).toBe(true);
  expect(blocked).toEqual([]);

  // A page of the app itself may show the app in a frame.
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/bienvenue";
    document.body.append(frame);
  });
  await expect(
    page.frameLocator("iframe").getByRole("heading", { name: "Bienvenue" }),
  ).toBeVisible();

  // A page elsewhere may not, even on the same site (another port here, a
  // sister address of the company's domain in real life), where the session
  // cookie would follow. A real server plays that other address.
  const elsewhere = createServer((_, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<iframe src="${baseURL}/bienvenue" width="390" height="600"></iframe>`);
  });
  await new Promise<void>((resolve) => elsewhere.listen(0, resolve));
  await page.goto(`http://localhost:${(elsewhere.address() as AddressInfo).port}/`, {
    waitUntil: "load",
  });
  elsewhere.close();
  const framed = page.frames().find((frame) => frame !== page.mainFrame());
  expect(framed?.url()).toMatch(/^chrome-error:/);
  // Refused because of what the app answered, not for want of an answer.
  expect(failures).toContainEqual({
    url: `${baseURL}/bienvenue`,
    reason: "net::ERR_BLOCKED_BY_RESPONSE",
  });
});

test("first-time setup, once done, answers the same whatever the code", async ({ request }) => {
  const code = process.env.SETUP_CODE ?? "e2e-setup-code-not-for-production";
  const right = await call(request, "POST", "/api/setup", { code, name: "Intrus" });
  const wrong = await call(request, "POST", "/api/setup", { code: "wrong", name: "Intrus" });
  expect(right.status).toBe(403);
  expect(right.body.error.message).toBe("L'application est déjà configurée.");
  expect(wrong).toMatchObject({ status: 403, body: right.body });
});

test("someone else's personal link does not replace the person signed in", async ({
  browser,
  baseURL,
}) => {
  const run = test.info().project.name;
  const office = await contextAs(browser, "admin");
  // A second office account on its own device: the seeded session must not
  // be the one that gets signed out.
  const officeName = `Bureau Essai ${run}`;
  const second = await post<{ id: string; invite: { url: string } }>(office.request, "/api/users", {
    name: officeName,
    role: "admin",
  });
  const device = await browser.newContext({ baseURL });
  const page = await device.newPage();
  await page.goto(new URL(second.invite.url).pathname);
  await page.getByRole("button", { name: "Entrer" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();

  // A worker asks the office to "look at" their link: it opens on that device.
  const workerName = `Essai Lien Tiers ${run}`;
  const worker = await post<{ invite: { url: string } }>(office.request, "/api/users", {
    name: workerName,
    role: "travailleur",
    projectIds: [seed.projectId],
  });
  const link = new URL(worker.invite.url).pathname;
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Cet appareil est déjà connecté" })).toBeVisible();
  await expect(page.getByText(`Il est connecté sous le nom de ${officeName}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrer" })).toHaveCount(0);
  // Nobody has a password: the screen says what signing out costs, and
  // staying signed in is the first thing it offers.
  await expect(
    page.getByText(
      `Pour revenir ensuite sous le nom de ${officeName}, il faudra un nouveau lien du bureau.`,
    ),
  ).toBeVisible();
  const [stay, leave] = await Promise.all(
    [
      page.getByRole("link", { name: "Ouvrir l'application" }),
      page.getByRole("button", { name: "Se déconnecter de cet appareil" }),
    ].map((control) => control.boundingBox()),
  );
  expect(stay!.y).toBeLessThan(leave!.y);
  expect(stay!.height).toBeGreaterThan(leave!.height);

  // The API refuses as well, before the link is used up.
  const refused = await call(device.request, "POST", `/api/invites/${link.split("/i/")[1]}`, {});
  expect(refused.status).toBe(409);
  expect(refused.body.error.message).toContain(`sous le nom de ${officeName}`);
  expect((await call(device.request, "GET", "/api/me")).body.name).toBe(officeName);

  // Signing out with no network: the device stays signed in, and says so.
  await page.route("**/api/logout", (route) => route.abort());
  await page.getByRole("button", { name: "Se déconnecter de cet appareil" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pas de réseau" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cet appareil est déjà connecté" })).toBeVisible();
  expect((await call(device.request, "GET", "/api/me")).body.name).toBe(officeName);
  await page.unroute("**/api/logout");

  // With the network: signed out for good, and the link now offers to enter.
  await page.getByRole("button", { name: "Se déconnecter de cet appareil" }).click();
  await expect(page.getByRole("heading", { name: `Bonjour ${workerName}` })).toBeVisible();
  expect((await call(device.request, "GET", "/api/me")).status).toBe(401);
  await page.getByRole("button", { name: "Entrer" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  expect((await call(device.request, "GET", "/api/me")).body.name).toBe(workerName);

  await call(office.request, "PATCH", `/api/users/${second.id}`, { active: false });
  await device.close();
  await office.close();
});

test("a QR code never makes a foreman the manager of another project", async ({ browser }) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  // The seeded foreman is on the first two projects, not on the third.
  const third = seed.otherProjectIds[1];
  const qr = await post<{ url: string }>(office.request, `/api/projects/${third}/qr`);
  const path = new URL(qr.url).pathname;

  // The screen says so before any button is pressed, and leads back to the app.
  const page = await foreman.newPage();
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Remplacement du ponceau du ruisseau Blanc" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `Vous êtes connecté sous le nom de ${seed.people.foreman}. Le code QR sert aux travailleurs. Demandez au bureau de vous ajouter à ce projet.`,
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter le projet" })).toHaveCount(0);
  // The API refuses whatever the screen shows.
  const invite = `/api/invites/${path.split("/j/")[1]}`;
  const refused = await call(foreman.request, "POST", invite, {});
  expect(refused.status).toBe(403);
  expect(refused.body.error.message).toBe(
    "Le code QR sert aux travailleurs. Demandez au bureau de vous ajouter à ce projet.",
  );
  expect((await call(foreman.request, "GET", `/api/projects/${third}`)).status).toBe(404);
  await page.getByRole("link", { name: "Ouvrir l'application" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await expect(page.getByText("Réfection de la rue Principale")).toBeVisible();
  await expect(page.getByText("Remplacement du ponceau du ruisseau Blanc")).toHaveCount(0);

  // The office opens the same code: let through, and put on no list. Its
  // screen offers to open the project, with nothing to "add".
  const opened = await call(office.request, "POST", invite, {});
  expect(opened).toMatchObject({ status: 200, body: { projectId: third } });
  const desk = await office.newPage();
  await desk.goto(path);
  await expect(desk.getByText("Vous avez déjà accès à ce projet.")).toBeVisible();
  await expect(desk.getByRole("button", { name: "Ajouter le projet" })).toHaveCount(0);
  await desk.getByRole("link", { name: "Ouvrir le projet" }).click();
  await expect(desk).toHaveURL(new RegExp(`/projets/${third}$`));
  await expect(
    desk.getByRole("heading", { name: "Remplacement du ponceau du ruisseau Blanc" }),
  ).toBeVisible();
  const members = await call<{ name: string }[]>(
    office.request,
    "GET",
    `/api/projects/${third}/members`,
  );
  expect(members.body.map((member) => member.name)).not.toContain(seed.people.admin);
  expect(members.body.map((member) => member.name)).not.toContain(seed.people.foreman);
  await foreman.close();
  await office.close();
});

test("an archived project lets nobody in and takes nothing new", async ({ browser, baseURL }) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const worker = await contextAs(browser, "worker");
  const project = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai sécurité, projet archivé (${test.info().project.name})`,
  });
  const ids = await Promise.all(
    [foreman, worker].map(async (who) => (await call(who.request, "GET", "/api/me")).body.id),
  );
  await post(office.request, `/api/projects/${project.id}/members`, { userIds: ids });
  const qr = await post<{ url: string }>(foreman.request, `/api/projects/${project.id}/qr`);
  const path = new URL(qr.url).pathname;
  const invite = `/api/invites/${path.split("/j/")[1]}`;
  const announce = (who: typeof office, kind: "plan" | "document" | "photo") =>
    call(who.request, "POST", "/api/uploads", {
      projectId: project.id,
      kind,
      filename: kind === "photo" ? "essai.jpg" : "essai.pdf",
      contentType: kind === "photo" ? "image/jpeg" : "application/pdf",
      size: 10,
    });

  // Open: the code admits, and its members add to it.
  const stranger = await api.newContext({ baseURL });
  expect((await call(stranger, "GET", invite)).status).toBe(200);
  expect((await announce(foreman, "plan")).status).toBe(200);
  expect((await announce(worker, "photo")).status).toBe(200);

  const archived = await call(office.request, "PATCH", `/api/projects/${project.id}`, {
    status: "archive",
  });
  expect(archived.body.status).toBe("archive");

  // Nobody new joins: the code made before archiving is an expired link.
  expect((await call(stranger, "GET", invite)).status).toBe(410);
  expect((await call(stranger, "POST", invite, { name: "Essai Trop Tard" })).status).toBe(410);
  const device = await browser.newContext({ baseURL });
  const page = await device.newPage();
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "Ce lien ne fonctionne plus" })).toBeVisible();
  await device.close();

  // Nothing new is added, except by the office.
  for (const [who, kind] of [
    [foreman, "plan"],
    [foreman, "document"],
    [worker, "photo"],
  ] as const) {
    const refused = await announce(who, kind);
    expect(refused.status, kind).toBe(403);
    expect(refused.body.error.message, kind).toBe("Ce projet est archivé.");
  }
  expect((await announce(office, "plan")).status).toBe(200);

  // Its members still read it.
  expect((await call(worker.request, "GET", `/api/projects/${project.id}`)).status).toBe(200);
  expect((await call(foreman.request, "GET", `/api/projects/${project.id}/plans`)).status).toBe(
    200,
  );

  // The seeded people's project lists are left as they were.
  for (const id of ids)
    await call(office.request, "DELETE", `/api/projects/${project.id}/members/${id}`);
  await stranger.dispose();
  await Promise.all([office.close(), foreman.close(), worker.close()]);
});

test("a QR code lets in exactly as many people as it has places", async ({ browser, baseURL }) => {
  const run = test.info().project.name;
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, prepare: false });
  const office = await contextAs(browser, "admin");
  const project = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai sécurité, places d'un code QR (${run})`,
  });
  const qr = await post<{ url: string }>(office.request, `/api/projects/${project.id}/qr`);
  const invite = `/api/invites/${new URL(qr.url).pathname.split("/j/")[1]}`;

  // A code has 40 places; leave four, rather than create 40 accounts here.
  const [code] = await sql`update invites set uses = max_uses - 4
                           where project_id = ${project.id} and kind = 'project'
                           returning id, max_uses`;
  expect(code.max_uses).toBe(40);
  const usesLeft = async () => {
    const [{ left }] = await sql`select max_uses - uses as left from invites where id = ${code.id}`;
    return left as number;
  };

  // Someone already in takes none of them.
  for (let i = 0; i < 3; i++)
    expect((await call(office.request, "POST", invite, {})).status).toBe(200);
  // Nor does a name the database would refuse (it used to take a place and create nobody).
  const stranger = await api.newContext({ baseURL });
  const unstorable = await call(stranger, "POST", invite, { name: "Jean\u0000Tremblay" });
  expect(unstorable.status).toBe(400);
  expect(await usesLeft()).toBe(4);

  // A worker with an account who asks ten times at the same moment takes one place.
  const worker = await contextAs(browser, "worker");
  const workerId = (await call(worker.request, "GET", "/api/me")).body.id;
  const tenTimes = await Promise.all(
    Array.from({ length: 10 }, () => call(worker.request, "POST", invite, {})),
  );
  expect(tenTimes.map((answer) => answer.status)).toEqual(Array(10).fill(200));
  expect(await usesLeft()).toBe(3);

  // Eight people scan at the same moment: three get in.
  const devices = await Promise.all(Array.from({ length: 8 }, () => api.newContext({ baseURL })));
  const answers = await Promise.all(
    devices.map((device, i) =>
      call(device, "POST", invite, { name: `Essai Place ${i + 1} (${run})` }),
    ),
  );
  expect(answers.map((answer) => answer.status).sort()).toEqual([
    200, 200, 200, 410, 410, 410, 410, 410,
  ]);
  const members = await call<{ id: string; unreviewed: boolean }[]>(
    office.request,
    "GET",
    `/api/projects/${project.id}/members`,
  );
  const scanned = members.body.filter((member) => member.id !== workerId);
  expect(members.body).toHaveLength(4);
  expect(scanned.every((member) => member.unreviewed)).toBe(true);
  expect(await usesLeft()).toBe(0);

  // The full code is an expired link for anyone new. Those already in still
  // open the project with it: the office, and someone who got in.
  expect((await call(stranger, "GET", invite)).status).toBe(410);
  expect((await call(stranger, "POST", invite, { name: "Essai Trop Tard" })).status).toBe(410);
  const winner = devices[answers.findIndex((answer) => answer.status === 200)];
  for (const already of [office.request, winner, worker.request]) {
    const preview = await call(already, "GET", invite);
    expect(preview).toMatchObject({ status: 200, body: { access: "open", projectId: project.id } });
    expect(await call(already, "POST", invite, {})).toMatchObject({
      status: 200,
      body: { projectId: project.id },
    });
  }
  expect(await usesLeft()).toBe(0);

  // Whoever got in by QR code is signed in for seven days, until confirmed.
  const { cookies } = await winner.storageState();
  const session = cookies.find((cookie) => cookie.name === "ead_session");
  expect(Math.abs((session?.expires ?? 0) - (Date.now() / 1000 + 7 * DAY))).toBeLessThan(120);

  // The seeded worker's project list is left as it was.
  await call(office.request, "DELETE", `/api/projects/${project.id}/members/${workerId}`);
  await Promise.all([...devices, stranger].map((device) => device.dispose()));
  await Promise.all([office.close(), worker.close()]);
  await sql.end();
});

test("an upload link takes the announced file, once", async ({ browser }) => {
  const worker = await contextAs(browser, "worker");
  const ticket = await post<{
    uploadId: string;
    target: { url: string; headers: Record<string, string> };
  }>(worker.request, "/api/uploads", {
    projectId: seed.projectId,
    kind: "photo",
    filename: "essai.jpg",
    contentType: "image/jpeg",
    size: 10,
  });
  const send = async (length: number, headers: Record<string, string> = {}) =>
    (
      await worker.request.put(ticket.target.url, {
        data: Buffer.alloc(length, 7),
        headers: { ...ticket.target.headers, ...headers },
      })
    ).status();
  const complete = () => call(worker.request, "POST", `/api/uploads/${ticket.uploadId}/complete`);

  // 10 bytes announced: 3,000 are refused, and so is another type.
  expect(await send(3000)).toBe(413);
  expect(await send(10, { "content-type": "text/html" })).toBe(415);
  expect((await complete()).status).toBe(400);
  // A shorter file gets in, and is deleted when the upload is confirmed.
  expect(await send(9)).toBe(200);
  expect((await complete()).body.error.message).toContain("incomplet");
  expect((await complete()).body.error.message).toContain("n'est pas arrivé");
  // The announced file is confirmed, and can no longer be replaced.
  expect(await send(10)).toBe(200);
  expect((await complete()).status).toBe(200);
  expect(await send(10)).toBe(409);
  await worker.close();
});

test("a send that is tried again and again does not lock its sender out", async ({ browser }) => {
  const run = test.info().project.name;
  const worker = await contextAs(browser, "worker");
  // The seeded worker starts with no unfinished upload, and ends so.
  const sql = postgres(process.env.DATABASE_URL ?? "", { max: 1, prepare: false });
  const workerId = (await call(worker.request, "GET", "/api/me")).body.id;
  const forget = () =>
    sql`delete from uploads where created_by = ${workerId} and status = 'pending'`;
  await forget();
  const announce = (filename: string) =>
    call(worker.request, "POST", "/api/uploads", {
      projectId: seed.projectId,
      kind: "photo",
      filename,
      contentType: "image/jpeg",
      size: 3_000_000,
    });
  // On a bad connection the app announces the same photo at each try: more
  // tries than a person may have unfinished uploads, and one upload in all.
  const tries = [];
  for (let i = 0; i < 35; i++) tries.push(await announce(`mauvais-signal-${run}.jpg`));
  expect(tries.map((answer) => answer.status)).toEqual(Array(35).fill(200));
  expect(new Set(tries.map((answer) => answer.body.uploadId)).size).toBe(1);

  // Different files are counted: 30 unfinished at a time, then a refusal
  // that says what to do. (One place is taken by the photo above.)
  const others = await Promise.all(
    Array.from({ length: 32 }, (_, i) => announce(`autre-${i}-${run}.jpg`)),
  );
  const refused = others.filter((answer) => answer.status === 429);
  expect(others.filter((answer) => answer.status === 200)).toHaveLength(29);
  expect(refused).toHaveLength(3);
  expect(refused[0].body.error).toEqual({
    code: "too_many_uploads",
    message:
      "Trop d'envois n'ont pas abouti. Réessayez plus tard\u00a0: ils s'effacent après trois heures.",
  });
  // And still the photo that keeps failing can be tried again.
  expect((await announce(`mauvais-signal-${run}.jpg`)).status).toBe(200);

  await forget();
  await sql.end();
  await worker.close();
});
