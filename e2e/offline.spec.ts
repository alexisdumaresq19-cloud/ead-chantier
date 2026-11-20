import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";

import { call, contextAs, post, seed, type Role } from "./support";

// The promise of the offline module, checked on the production build: what
// was opened once is still there without a network, and a foreman can keep a
// whole project on the device before leaving for the site. Every test opens
// its own browser context, so that no service worker, cache or stored data
// passes from one test to the next.

const SHELL = "ead-shell-v1";
const STATIC = "ead-static-v1";
const SEEN = "ead-seen-v1";
const KEPT = "ead-kept-v1";

const home = `/projets/${seed.projectId}`;
const sheetPath = (index: number) => `${home}/feuilles/${seed.sheetIds[index]}`;

/** Fails a test on the screen every crash ends on. */
const CRASH = "Une erreur est survenue";
/** What a screen says offline when it was never opened online. */
const NEVER_OPENED = "Cette page n'a pas encore été ouverte sur cet appareil";

type Device = { context: BrowserContext; page: Page; api: Response[] };
type Response = { url: string; fromWorker: boolean };

/** A new device signed in as `role` (or with no session), its first page, and the API answers it got. */
async function device(browser: Browser, role: Role | null, baseURL: string): Promise<Device> {
  const context = role
    ? await contextAs(browser, role, { baseURL })
    : await browser.newContext({ baseURL });
  const page = await context.newPage();
  const api: Response[] = [];
  context.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/"))
      api.push({ url: response.url(), fromWorker: response.fromServiceWorker() });
  });
  return { context, page, api };
}

/** The keys of the stored data (TanStack Query's copy in IndexedDB). */
function storedKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open("keyval-store");
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("keyval")) return resolve([]);
          const read = db.transaction("keyval").objectStore("keyval").get("ead-query-cache");
          read.onsuccess = () =>
            resolve(
              (
                (read.result?.clientState?.queries ?? []) as {
                  queryKey: unknown[];
                  state: { data?: unknown };
                }[]
              )
                .filter((query) => query.state.data !== undefined)
                .map((query) => JSON.stringify(query.queryKey)),
            );
        };
      }),
  );
}

/**
 * Waits until the device holds what a launch without a network needs: the
 * worker controls the page, the shell and every screen's code are stored,
 * and so is the data of the screens seen (`keys`, as JSON).
 */
async function readyForOffline(page: Page, keys: unknown[][] = []) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect
    .poll(
      () =>
        page.evaluate(async (name) => Boolean(await caches.match("/", { cacheName: name })), SHELL),
      {
        timeout: 30_000,
      },
    )
    .toBe(true);
  const wanted = keys.map((key) => JSON.stringify(key));
  await expect
    .poll(async () => {
      const stored = await storedKeys(page);
      return wanted.filter((key) => !stored.includes(key));
    })
    .toEqual([]);
}

/**
 * Cuts the network, after emptying the browser's own cache: what shows next
 * must come from what the app stored, which is all a phone can count on (its
 * browser cache is small and cleared at will).
 */
async function goOffline(page: Page) {
  const browser = await page.context().newCDPSession(page);
  await browser.send("Network.clearBrowserCache");
  await browser.detach();
  await page.context().setOffline(true);
}

/** Every address a cache holds, by cache. Not while a cache may be deleted: opening it makes it again. */
function cachedUrls(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const all: Record<string, string[]> = {};
    for (const name of await caches.keys())
      all[name] = (await (await caches.open(name)).keys()).map((request) => request.url);
    return all;
  });
}

/** No API answer came from the worker, and none sits in any cache. */
async function expectNoApiFromWorker({ page, api }: Device) {
  expect(api.length).toBeGreaterThan(0);
  expect(api.filter((response) => response.fromWorker)).toEqual([]);
  const stored = Object.values(await cachedUrls(page)).flat();
  expect(
    stored.filter((url) => /\/api\/|\/files\/(private|upload)\//.test(new URL(url).pathname)),
  ).toEqual([]);
}

/** Opens a tab of the project: the bar at the bottom on a phone, the side on a desktop. */
async function openTab(page: Page, name: string) {
  await page.getByRole("link", { name, exact: true }).first().click();
}

/**
 * The share of the screen the tiles cover with paper. Only OpenSeadragon's
 * canvas is looked at, on black: the thumbnail laid under it, the bars and
 * the messages over it would pass for tiles.
 */
async function paperDrawn(page: Page): Promise<number> {
  const canvas = page.locator('div[role="img"] canvas').first();
  const box = await canvas.boundingBox();
  if (!box) return 0;
  const isolate = (alone: boolean) =>
    canvas.evaluate((element, alone) => {
      const style = alone ? "#000" : "";
      document.documentElement.style.background = style;
      document.body.style.background = style;
      document.body.style.visibility = alone ? "hidden" : "";
      (element as HTMLElement).style.visibility = alone ? "visible" : "";
    }, alone);
  await isolate(true);
  const shot = await page.screenshot({ clip: box });
  await isolate(false);
  const { data, info } = await sharp(shot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let paper = 0;
  for (let index = 0; index < data.length; index += info.channels)
    if (data[index] > 225 && data[index + 1] > 225 && data[index + 2] > 225) paper++;
  return paper / (info.width * info.height);
}

/** Waits until the tiles drew the sheet, with no word of a missing part. */
async function expectSheetDrawn(page: Page) {
  await expect.poll(() => paperDrawn(page), { timeout: 20_000 }).toBeGreaterThan(0.2);
  await expect(page.getByText("Ce plan n'est pas encore sur cet appareil")).toHaveCount(0);
  await expect(page.getByText(/détails (de ce plan|n'ont pas)/)).toHaveCount(0);
}

/** Answers a confirmation: a window ignores taps in the moment after it opens. */
async function confirm(page: Page, label: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(500);
  await dialog.getByRole("button", { name: label }).click();
}

/** Zooms in by `steps` presses of « Agrandir » and lets the movement settle. */
async function zoomIn(page: Page, steps: number) {
  for (let step = 0; step < steps; step++) {
    await page.getByRole("button", { name: "Agrandir" }).click();
    await page.waitForTimeout(1200);
  }
}

test("after one visit, every screen of a project opens without a network", async ({
  browser,
  baseURL,
}) => {
  const foreman = await device(browser, "foreman", baseURL!);
  const { page, context } = foreman;
  await page.goto(home);
  await expect(page.getByRole("heading", { name: "Réfection de la rue Principale" })).toBeVisible();
  await openTab(page, "Plans");
  await expect(page.getByText("C-001")).toBeVisible();
  await readyForOffline(page, [
    ["me"],
    ["projects", seed.projectId],
    ["projects", seed.projectId, "plans"],
  ]);

  await goOffline(page);
  // A launch at a deep address of a screen never opened.
  const launch = await page.goto(`${home}/documents`);
  expect(launch!.fromServiceWorker()).toBe(true);
  // The stored shell keeps the protections the server gives every page.
  const headers = launch!.headers();
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'self'");
  expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("same-origin");
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
  await expect(page.getByText(NEVER_OPENED)).toBeVisible();

  await openTab(page, "Plans");
  await expect(page.getByText("C-001")).toBeVisible();
  await openTab(page, "Photos");
  await expect(page.getByText(NEVER_OPENED)).toBeVisible();
  await openTab(page, "Rapports");
  await expect(page.getByText(NEVER_OPENED)).toBeVisible();
  await openTab(page, "Accueil");
  await expect(page.getByRole("heading", { name: "Réfection de la rue Principale" })).toBeVisible();
  // The viewer, OpenSeadragon included, for a sheet never opened.
  await page.goto(sheetPath(2));
  await expect(page.getByText("Ce plan n'est pas encore sur cet appareil")).toBeVisible();
  await page.goto("/moi");
  await expect(page.getByRole("heading", { name: "Mon compte" })).toBeVisible();
  await expect(page.getByText(CRASH)).toHaveCount(0);

  await context.setOffline(false);
  await expectNoApiFromWorker(foreman);
  await context.close();
});

test("a kept project opens whole without a network, every sheet and every zoom", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const foreman = await device(browser, "foreman", baseURL!);
  const { page, context } = foreman;
  await page.goto(home);
  await page.getByRole("button", { name: "Garder sur cet appareil" }).click();
  await expect(page.getByText("Téléchargement en cours")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projet gardé sur cet appareil" })).toBeVisible({
    timeout: 90_000,
  });
  // Counted now: another spec may have archived or added a sheet since the seed.
  const live = await call<{ sheets: unknown[] }>(
    context.request,
    "GET",
    `/api/projects/${seed.projectId}/plans`,
  );
  const sheetCount = live.body.sheets.length;
  await expect(page.getByText(`${sheetCount} feuilles ·`)).toBeVisible();
  await readyForOffline(page, [["projects", seed.projectId, "plans"]]);
  const cached = await cachedUrls(page);
  // Kept on purpose, never filed with what was merely seen.
  expect(cached[KEPT].length).toBeGreaterThan(sheetCount * 10);
  expect(cached[SEEN] ?? []).toEqual([]);

  await goOffline(page);
  await page.goto(`${home}/plans`);
  await expect(page.getByText("C-001")).toBeVisible();
  await page.getByRole("link", { name: /C-101/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/feuilles/${seed.sheetIds[1]}$`));
  await expectSheetDrawn(page);
  await zoomIn(page, 3);
  await expectSheetDrawn(page);
  // Sheets never opened on this device, one after the other.
  for (let turn = 0; turn < 2; turn++) {
    await page.getByRole("button", { name: "Feuille suivante" }).click();
    await expectSheetDrawn(page);
  }
  await zoomIn(page, 2);
  await expectSheetDrawn(page);
  await expect(page.getByText(CRASH)).toHaveCount(0);

  await context.setOffline(false);
  await expectNoApiFromWorker(foreman);
  await context.close();
});

test("a sheet looked at once online opens without a network at the zoom it was seen", async ({
  browser,
  baseURL,
}) => {
  const worker = await device(browser, "worker", baseURL!);
  const { page, context } = worker;
  await page.goto(sheetPath(0));
  await expectSheetDrawn(page);
  await zoomIn(page, 2);
  await expectSheetDrawn(page);
  await readyForOffline(page, [["projects", seed.projectId, "sheet", seed.sheetIds[0]]]);

  await goOffline(page);
  await page.reload();
  await expectSheetDrawn(page);
  await zoomIn(page, 2);
  await expectSheetDrawn(page);

  // Not looked at, not kept: said plainly, no crash.
  await page.goto(sheetPath(4));
  await expect(page.getByText("Ce plan n'est pas encore sur cet appareil")).toBeVisible();
  // What the tiles draw is told apart from what they do not.
  expect(await paperDrawn(page)).toBeLessThan(0.01);
  await context.setOffline(false);
  await expectNoApiFromWorker(worker);
  // Filed as seen: the browser may trim it, unlike a kept project.
  const cached = await cachedUrls(page);
  expect(cached[SEEN].length).toBeGreaterThan(1);
  expect(cached[KEPT] ?? []).toEqual([]);
  await context.close();
});

test("photos seen once show without a network, and the worker leaves uploads alone", async ({
  browser,
  baseURL,
}) => {
  const run = test.info().project.name;
  const caption = `Essai hors ligne ${run}`;
  const foreman = await device(browser, "foreman", baseURL!);
  const { page, context } = foreman;
  await page.goto(`${home}/photos`);
  await readyForOffline(page);

  // Sent from the page the worker controls, the way the app sends a photo.
  const jpeg = await sharp({
    create: { width: 640, height: 480, background: { r: 30, g: 110, b: 170 }, channels: 3 },
  })
    .jpeg()
    .toBuffer();
  const sent = await page.evaluate(
    async ({ projectId, bytes, caption }) => {
      const json = async (path: string, body: unknown) => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        return response.json();
      };
      const file = new Uint8Array(bytes);
      const ticket = await json("/api/uploads", {
        projectId,
        kind: "photo",
        filename: "essai.jpg",
        contentType: "image/jpeg",
        size: file.length,
      });
      const put = () =>
        fetch(ticket.target.url, { method: "PUT", headers: ticket.target.headers, body: file });
      const first = await put();
      // The link writes once: the worker did not spend it on the way.
      const second = await put();
      await json(`/api/uploads/${ticket.uploadId}/complete`, {});
      await json(`/api/projects/${projectId}/photos`, { uploadId: ticket.uploadId, caption });
      return { first: first.status, second: second.status, target: ticket.target.url as string };
    },
    { projectId: seed.projectId, bytes: [...jpeg], caption },
  );
  expect(sent.first).toBe(200);
  expect(sent.second).toBeGreaterThanOrEqual(400);

  await page.reload();
  const tile = page.getByRole("button", { name: caption }).first();
  await expect(tile.locator("img")).toHaveJSProperty("complete", true);
  await tile.click();
  const large = page.getByRole("img", { name: caption });
  await expect(large).toBeVisible();
  await expect
    .poll(() => large.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await readyForOffline(page, [["projects", seed.projectId, "photos", "list", "all"]]);

  await goOffline(page);
  await page.goto(`${home}/photos`);
  const offlineTile = page.getByRole("button", { name: caption }).first();
  await expect
    .poll(() =>
      offlineTile.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await offlineTile.click();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: caption })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await context.setOffline(false);

  await expectNoApiFromWorker(foreman);
  const stored = Object.values(await cachedUrls(page)).flat();
  expect(stored.some((url) => url.includes(new URL(sent.target, baseURL).pathname))).toBe(false);
  await context.close();
});

test("a cut download goes on where it stopped, and removing the project frees its files", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const { page, context } = await device(browser, "foreman", baseURL!);
  await page.goto(home);
  await page.getByRole("button", { name: "Garder sur cet appareil" }).click();
  const bar = page.getByRole("progressbar", { name: "Téléchargement du projet" });
  await expect
    .poll(async () => Number((await bar.getAttribute("aria-valuenow")) ?? 0), { timeout: 60_000 })
    .toBeGreaterThan(20);
  // The app is closed in the middle of it.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Téléchargement interrompu" })).toBeVisible();
  const held = (await cachedUrls(page))[KEPT];
  expect(held.length).toBeGreaterThan(0);

  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/files/public/")) asked.push(request.url());
  });
  await page.getByRole("button", { name: "Reprendre" }).click();
  await expect(page.getByRole("heading", { name: "Projet gardé sur cet appareil" })).toBeVisible({
    timeout: 90_000,
  });
  const kept = (await cachedUrls(page))[KEPT];
  // Only what was missing was asked for again.
  expect(asked.filter((url) => held.includes(url))).toEqual([]);
  expect(asked.length).toBe(kept.length - held.length);

  await page.getByRole("button", { name: "Retirer de l'appareil" }).click();
  await confirm(page, "Retirer");
  await expect(
    page.getByRole("heading", { name: "Garder ce projet sur l'appareil" }),
  ).toBeVisible();
  expect((await cachedUrls(page))[KEPT] ?? []).toEqual([]);

  // Its plans are no longer on the device.
  await readyForOffline(page);
  await goOffline(page);
  await page.goto(sheetPath(5));
  await expect(page.getByText("Ce plan n'est pas encore sur cet appareil")).toBeVisible();
  await context.close();
});

test("signing out leaves nothing of the person on the device", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const run = test.info().project.name;
  // Someone of their own: the seeded sessions must stay signed in.
  const office = await contextAs(browser, "admin", { baseURL });
  const person = await post<{ invite: { url: string } }>(office.request, "/api/users", {
    name: `Essai Sortie ${run === "phone" ? "Mobile" : "Bureau"}`,
    role: "contremaitre",
    projectIds: [seed.projectId],
  });
  await office.close();

  const { page, context } = await device(browser, null, baseURL!);
  await page.goto(new URL(person.invite.url).pathname);
  await page.getByRole("button", { name: "Entrer" }).click();
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await page.goto(home);
  await page.getByRole("button", { name: "Garder sur cet appareil" }).click();
  await expect(page.getByRole("heading", { name: "Projet gardé sur cet appareil" })).toBeVisible({
    timeout: 90_000,
  });
  await page.goto(sheetPath(0));
  await expectSheetDrawn(page);
  await page.goto(`${home}/photos`);
  await expect(page.getByRole("heading", { name: "Photos", level: 1 })).toBeVisible();
  await readyForOffline(page, [["me"], ["projects", seed.projectId]]);

  await page.goto("/moi");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await confirm(page, "Se déconnecter");
  await expect(page).toHaveURL(/\/bienvenue$/);
  await expect(page.getByRole("heading", { name: "Bienvenue" })).toBeVisible();

  // Names only: opening a cache as it is being deleted would make it again.
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).sort()))
    .toEqual([SHELL, STATIC]);
  // Of the stored data, only the fact that nobody is signed in.
  await expect
    .poll(async () => (await storedKeys(page)).filter((key) => key !== '["me"]'))
    .toEqual([]);
  expect(await call(context.request, "GET", "/api/me")).toMatchObject({ status: 401 });
  const keptRecords = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("ead-kept");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("projects")) return resolve(0);
          const count = db.transaction("projects").objectStore("projects").count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(keptRecords).toBe(0);
  await context.close();
});

test("a new version shows the update bar, and only the person's tap loads it", async ({
  browser,
  baseURL,
}) => {
  const foreman = await device(browser, "foreman", baseURL!);
  const { page, context } = foreman;
  await page.goto(home);
  await readyForOffline(page, [["me"], ["projects", seed.projectId]]);
  const current = (await call(context.request, "GET", "/api/version")).body.version as string;
  const storedShell = () =>
    page.evaluate(async (name) => (await caches.match("/", { cacheName: name }))!.text(), SHELL);

  // A new deployment: the server names another build and sends another page,
  // whose files have other names (here its style sheet).
  let networkDown = false;
  const network = async (up: boolean) => {
    networkDown = !up;
    if (up) await context.setOffline(false);
    else await goOffline(page);
  };
  await context.route("**/api/version", (route) =>
    networkDown
      ? route.abort("internetdisconnected")
      : route.fulfill({ json: { version: `${current}-nouvelle` } }),
  );
  await context.route(
    (url) => url.origin === baseURL && (url.pathname === "/" || url.pathname === home),
    async (route) => {
      // Fetched by the test runner, which the browser's offline mode does not stop.
      if (networkDown) return route.abort("internetdisconnected");
      const response = await route.fetch();
      const html = (await response.text())
        .replace(/(href="\/_next\/static\/chunks\/[^"?]+\.css)"/, '$1?build=nouvelle"')
        .replace("</head>", '<meta name="e2e-build" content="nouvelle"/></head>');
      await route.fulfill({ response, body: html });
    },
  );

  // The tab opened before the deployment, from the device.
  await network(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Réfection de la rue Principale" })).toBeVisible();
  await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));
  await network(true);
  const bar = page.getByRole("status").filter({ hasText: "Nouvelle version disponible" });
  await expect(bar).toBeVisible();
  // It offers and waits: the page does not reload under the person.
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  // The old page never stores the new shell as its own.
  expect(await storedShell()).not.toContain("e2e-build");

  await bar.getByRole("button", { name: "Plus tard" }).click();
  await expect(bar).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1000);
  await expect(bar).toHaveCount(0);

  // The next opening offers it again.
  await network(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Réfection de la rue Principale" })).toBeVisible();
  await network(true);
  await expect(bar).toBeVisible();

  await bar.getByRole("button", { name: "Mettre à jour" }).click();
  await expect(page.locator('meta[name="e2e-build"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Réfection de la rue Principale" })).toBeVisible();
  // From the server, not from the device; and nothing left to offer.
  await expect(page.locator('meta[name="ead-shell"]')).toHaveCount(0);
  await expect(bar).toHaveCount(0);
  // The new version is what opens next without a network.
  await expect.poll(storedShell, { timeout: 30_000 }).toContain("e2e-build");
  expect(await storedShell()).toContain(`content="${current}-nouvelle"`);
  await network(false);
  await page.reload();
  await expect(page.locator('meta[name="e2e-build"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Réfection de la rue Principale" })).toBeVisible();
  await network(true);
  await expectNoApiFromWorker(foreman);
  // The app may still be asking: let it go unanswered as the context closes.
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.close();
});
