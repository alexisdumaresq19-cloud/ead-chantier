import { readFileSync } from "node:fs";

import {
  expect,
  request as api,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { levelGrid, type Plans, type SheetDetail, type Tiles } from "../src/shared/plans";
import { call, contextAs, post, seed, type Role } from "./support";

// The full-screen plan viewer, on the production build: a sheet opens from
// the list at once, sharp, with only the tiles in view; it is moved, turned
// and left; older revisions say they are replaced; a sheet that is gone or
// closed to someone says so. The timings it measures are printed and held
// under generous bounds.

const SHEET_PATH = `/projets/${seed.projectId}/feuilles`;
const LIST_PATH = `/projets/${seed.projectId}/plans`;
const PDF = `${process.env.SEED_OUT ?? ".data/e2e"}/plans-exemple.pdf`;

// --- Set-up -----------------------------------------------------------------

/** The settings of the device the test runs as (phone or desktop). */
function device() {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, timezoneId } =
    test.info().project.use;
  return { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent, locale, timezoneId };
}

/**
 * Someone signed in on this device. The service worker is kept out unless
 * asked for: it would answer tiles from its cache and hide what the network
 * carries.
 */
const signedIn = (browser: Browser, role: Role, serviceWorkers: "allow" | "block" = "block") =>
  contextAs(browser, role, { ...device(), serviceWorkers });

async function livePlans(context: BrowserContext) {
  const { status, body } = await call<Plans>(
    context.request,
    "GET",
    `/api/projects/${seed.projectId}/plans`,
  );
  expect(status).toBe(200);
  return body;
}

/** The sheet C-101 has two revisions, so the older one can be looked at. */
test.beforeAll(async ({ browser }) => {
  const foreman = await contextAs(browser, "foreman");
  const sheet = (await call<SheetDetail>(foreman.request, "GET", `/api/sheets/${seed.sheetIds[1]}`))
    .body;
  if (sheet.revisions.length < 2) {
    test.setTimeout(240_000);
    const pdf = readFileSync(PDF);
    const ticket = await post<{
      uploadId: string;
      target: { url: string; headers: Record<string, string> };
    }>(foreman.request, "/api/uploads", {
      projectId: seed.projectId,
      kind: "plan",
      filename: "Plans civils — révision A.pdf",
      contentType: "application/pdf",
      size: pdf.length,
    });
    const put = await foreman.request.fetch(new URL(ticket.target.url, seed.base).toString(), {
      method: "PUT",
      headers: ticket.target.headers,
      data: pdf,
    });
    expect(put.ok()).toBe(true);
    await post(foreman.request, `/api/uploads/${ticket.uploadId}/complete`);
    const started = await post<{ id: string }>(
      foreman.request,
      `/api/projects/${seed.projectId}/plan-imports`,
      { uploadId: ticket.uploadId, revisionLabel: "A", issuedOn: "2026-11-15" },
    );
    await expect
      .poll(
        async () =>
          (await call(foreman.request, "GET", `/api/plan-imports/${started.id}`)).body.status,
        { timeout: 200_000, intervals: [1500] },
      )
      .toBe("review");
    await post(foreman.request, `/api/plan-imports/${started.id}/publish`);
  }
  await foreman.close();
});

// --- What the screen shows --------------------------------------------------

const viewer = (page: Page) => page.locator("[data-tiles]");
const sharp = (page: Page) => expect(viewer(page)).toHaveAttribute("data-tiles", "sharp");
const counter = (page: Page) => page.locator('[aria-label^="Feuille "][aria-label*=" de "]');
const topBar = (page: Page) => page.locator("header");

/** A tile's place in its pyramid, from its address. */
function tileOf(url: string) {
  const match = /\/files\/public\/t\/([^/]+)\/(\d+)\/(\d+)_(\d+)\.webp$/.exec(
    new URL(url).pathname,
  );
  return match
    ? { key: match[1], level: Number(match[2]), column: Number(match[3]), row: Number(match[4]) }
    : null;
}

/** Every tile the page asks for, with the size of what came back. */
function watchTiles(page: Page) {
  const tiles: { key: string; level: number; column: number; row: number; bytes: number }[] = [];
  page.on("requestfinished", async (request) => {
    const tile = tileOf(request.url());
    if (!tile) return;
    const sizes = await request.sizes().catch(() => null);
    tiles.push({ ...tile, bytes: sizes?.responseBodySize ?? 0 });
  });
  return tiles;
}

const keyOf = (tiles: Tiles) => tiles.url.split("/").pop()!;

/**
 * The sheet as the canvas draws it, the thumbnail under it set aside: the
 * box of white paper on screen (CSS pixels) and how much of that box is ink.
 */
async function drawnPaper(page: Page) {
  await page.addStyleTag({
    content: "[data-tiles] [role=img] img { visibility: hidden !important }",
  });
  const shot = await page.screenshot();
  return page.evaluate(async (png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    const white = (i: number) => data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
    // Rows and columns mostly of paper: the white lettering of the bars never fills one.
    const rows: number[] = [];
    const columns: number[] = [];
    for (let y = 0; y < height; y += 2) {
      let count = 0;
      for (let x = 0; x < width; x += 2) if (white((y * width + x) * 4)) count++;
      if (count > width / 2 / 4) rows.push(y);
    }
    for (let x = 0; x < width; x += 2) {
      let count = 0;
      for (let y = 0; y < height; y += 2) if (white((y * width + x) * 4)) count++;
      if (count > height / 2 / 8) columns.push(x);
    }
    const [top, bottom] = [rows[0] ?? 0, rows.at(-1) ?? -1];
    const [left, right] = [columns[0] ?? 0, columns.at(-1) ?? -1];
    let inside = 0;
    let ink = 0;
    for (let y = top; y <= bottom; y += 2)
      for (let x = left; x <= right; x += 2) {
        inside++;
        const i = (y * width + x) * 4;
        if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) ink++;
      }
    const scale = width / window.innerWidth;
    return {
      x: left / scale,
      y: top / scale,
      width: (right - left) / scale,
      height: (bottom - top) / scale,
      ink: inside ? ink / inside : 0,
    };
  }, shot.toString("base64"));
}

/**
 * Times, in the page, from the finger landing on a link to the thumbnail
 * being drawn and to the tiles in view all being drawn.
 */
async function startClock(page: Page) {
  await page.evaluate(() => {
    const clock = { tap: 0, thumb: 0, sharp: 0 };
    (window as unknown as { clock: typeof clock }).clock = clock;
    document.addEventListener(
      "pointerdown",
      () => Object.assign(clock, { tap: performance.now(), thumb: 0, sharp: 0 }),
      true,
    );
    const look = () => {
      if (clock.tap) {
        const thumb = document.querySelector<HTMLImageElement>("[data-tiles] [role=img] img");
        if (!clock.thumb && thumb?.complete && thumb.naturalWidth > 0)
          clock.thumb = performance.now() - clock.tap;
        if (!clock.sharp && document.querySelector('[data-tiles="sharp"]'))
          clock.sharp = performance.now() - clock.tap;
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}
const readClock = (page: Page) =>
  page.evaluate(() => (window as unknown as { clock: { thumb: number; sharp: number } }).clock);

function report(name: string, value: string | number) {
  test.info().annotations.push({ type: name, description: String(value) });
  console.log(`[viewer ${test.info().project.name}] ${name}: ${value}`);
}

// --- Tests ------------------------------------------------------------------

test("a sheet tapped in the list is on screen at once, sharp, with only the tiles in view", async ({
  browser,
}) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  const plans = await livePlans(context);
  const sheet = plans.sheets.find((one) => one.number === "C-101")!;
  const tiles = watchTiles(page);

  await page.goto(LIST_PATH);
  await expect(page.getByRole("link", { name: /C-101/ })).toBeVisible();
  // The list's thumbnails are in; the clock starts with the finger.
  await page.waitForLoadState("networkidle");
  await startClock(page);
  await page.getByRole("link", { name: /C-101/ }).first().click();

  await expect(page.getByRole("heading", { level: 1, name: "C-101" })).toBeVisible();
  await expect(page.getByText(sheet.title, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rév. A, voir les révisions" })).toBeVisible();
  await sharp(page);
  await page.waitForTimeout(300);
  const clock = await readClock(page);
  const own = tiles.filter((tile) => tile.key === keyOf(sheet.current!.tiles));
  const bytes = own.reduce((sum, tile) => sum + tile.bytes, 0);
  report("tap to thumbnail (ms)", Math.round(clock.thumb));
  report("tap to sharp at fit (ms)", Math.round(clock.sharp));
  report("tile requests at fit", own.length);
  report("tile weight at fit (kB)", Math.round(bytes / 1024));
  expect(clock.thumb).toBeGreaterThan(0);
  expect(clock.thumb).toBeLessThan(1500);
  expect(clock.sharp).toBeLessThan(5000);

  // Only what a screen needs: a handful of tiles, none of the finest level,
  // each asked for once.
  const { maxLevel } = sheet.current!.tiles;
  expect(own.length).toBeGreaterThan(0);
  expect(own.length).toBeLessThanOrEqual(10);
  expect(own.every((tile) => tile.level < maxLevel)).toBe(true);
  expect(new Set(own.map((t) => `${t.level}/${t.column}_${t.row}`)).size).toBe(own.length);
  expect(bytes).toBeLessThan(1_500_000);

  // The canvas itself holds the sheet: white paper, lines on it.
  const paper = await drawnPaper(page);
  // Shown whole, as large as the screen allows.
  const screen = page.viewportSize()!;
  expect(Math.max(paper.width / screen.width, paper.height / screen.height)).toBeGreaterThan(0.7);
  expect(paper.width).toBeGreaterThan(paper.height);
  expect(paper.ink).toBeGreaterThan(0.005);

  // Once the viewer's code is in, as it is after the app's first minutes.
  await page.getByRole("button", { name: "Retour aux plans" }).click();
  await expect(page).toHaveURL(LIST_PATH);
  await startClock(page);
  await page.getByRole("link", { name: /C-103/ }).first().click();
  await sharp(page);
  await page.waitForTimeout(100);
  const again = await readClock(page);
  report("code loaded: tap to thumbnail (ms)", Math.round(again.thumb));
  report("code loaded: tap to sharp (ms)", Math.round(again.sharp));
  expect(again.thumb).toBeLessThan(500);
  expect(again.sharp).toBeLessThan(3000);
  await context.close();
});

test("the sheet zooms, turns and comes back whole; deep in a corner only that corner loads", async ({
  browser,
}) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  const plans = await livePlans(context);
  const sheet = plans.sheets.find((one) => one.number === "C-102")!;
  const tiles = watchTiles(page);
  await page.goto(`${SHEET_PATH}/${sheet.id}`);
  await sharp(page);

  const zoomOut = page.getByRole("button", { name: "Réduire" });
  const zoomIn = page.getByRole("button", { name: "Agrandir" });
  const fit = page.getByRole("button", { name: "Voir toute la feuille" });
  await expect(zoomOut).toBeDisabled();
  await expect(fit).toBeDisabled();
  await zoomIn.click();
  await expect(zoomOut).toBeEnabled();
  await zoomOut.click();
  await expect(zoomOut).toBeDisabled();
  await zoomIn.click();
  await fit.click();
  await expect(fit).toBeDisabled();

  // A quarter turn: the wide sheet stands up, and stays whole.
  const upright = await drawnPaper(page);
  await page.getByRole("button", { name: "Tourner d'un quart de tour" }).click();
  await page.waitForTimeout(1200);
  await sharp(page);
  const turned = await drawnPaper(page);
  expect(turned.height).toBeGreaterThan(turned.width);
  expect(upright.width).toBeGreaterThan(upright.height);
  for (let turn = 0; turn < 3; turn++)
    await page.getByRole("button", { name: "Tourner d'un quart de tour" }).click();
  await page.waitForTimeout(1200);

  // A tap shows and hides the bars; a double tap zooms on the point and
  // leaves them as they were.
  const paper = await drawnPaper(page);
  const middle = { x: paper.x + paper.width / 2, y: paper.y + paper.height / 2 };
  const tap = (x: number, y: number) =>
    device().hasTouch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
  await tap(middle.x, middle.y);
  await expect.poll(() => topBar(page).evaluate((bar) => (bar as HTMLElement).inert)).toBe(true);
  await tap(middle.x, middle.y);
  await expect.poll(() => topBar(page).evaluate((bar) => (bar as HTMLElement).inert)).toBe(false);

  // Into the top-left corner, double tap after double tap, to the limit.
  const corner = { x: paper.x + paper.width * 0.04, y: paper.y + paper.height * 0.05 };
  tiles.length = 0;
  for (let step = 0; step < 8 && (await zoomIn.isEnabled()); step++) {
    await tap(corner.x, corner.y);
    await page.waitForTimeout(150);
    await tap(corner.x, corner.y);
    await page.waitForTimeout(1000);
  }
  await expect(zoomIn).toBeDisabled();
  await expect(topBar(page)).not.toHaveJSProperty("inert", true);
  await sharp(page);
  const { maxLevel } = sheet.current!.tiles;
  const grid = levelGrid(sheet.current!.tiles, maxLevel);
  const finest = tiles.filter(
    (tile) => tile.key === keyOf(sheet.current!.tiles) && tile.level === maxLevel,
  );
  report("finest tiles loaded in a corner", `${finest.length} of ${grid.columns * grid.rows}`);
  expect(finest.length).toBeGreaterThan(0);
  expect(finest.length).toBeLessThanOrEqual(8);
  expect(finest.every((tile) => tile.column <= 2 && tile.row <= 2)).toBe(true);

  await fit.click();
  await expect(fit).toBeDisabled();
  await context.close();
});

test("next and previous turn the sheets with their counter, and back returns to the list", async ({
  browser,
}) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  const plans = await livePlans(context);
  const total = plans.sheets.length;
  const at = plans.sheets.findIndex((one) => one.number === "C-101");

  await page.goto(LIST_PATH);
  await page.getByPlaceholder("Rechercher un plan").fill("profil");
  const result = page.getByRole("link", { name: /C-102/ });
  await expect(result).toBeVisible();
  // The time to read the results: the list keeps its search a moment after typing.
  await page.waitForTimeout(500);
  await result.click();
  await sharp(page);
  // Back to the list as it was left, with its search.
  await page.getByRole("button", { name: "Retour aux plans" }).click();
  await expect(page).toHaveURL(LIST_PATH);
  await expect(page.getByPlaceholder("Rechercher un plan")).toHaveValue("profil");
  await page.getByPlaceholder("Rechercher un plan").fill("");
  await page.waitForTimeout(500);

  await page.getByRole("link", { name: /C-101/ }).first().click();
  await sharp(page);
  await expect(counter(page)).toHaveText(`${at + 1} / ${total}`);
  await startClock(page);
  await page.getByRole("button", { name: "Feuille suivante" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(plans.sheets[at + 1].number);
  await expect(counter(page)).toHaveText(`${at + 2} / ${total}`);
  await sharp(page);
  await page.waitForTimeout(100);
  const clock = await readClock(page);
  report("next sheet to sharp (ms)", Math.round(clock.sharp));
  expect(clock.sharp).toBeLessThan(3000);
  await page.getByRole("button", { name: "Feuille précédente" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("C-101");
  await expect(counter(page)).toHaveText(`${at + 1} / ${total}`);
  // The keyboard of the office does the same.
  await page.keyboard.press("PageDown");
  await expect(counter(page)).toHaveText(`${at + 2} / ${total}`);

  // Sheets replace each other in history: the browser's back leaves in one step.
  await page.goBack();
  await expect(page).toHaveURL(LIST_PATH);
  await expect(page.getByRole("link", { name: /C-101/ }).first()).toBeVisible();

  // At either end the way further is closed.
  await page.goto(`${SHEET_PATH}/${plans.sheets[0].id}`);
  await sharp(page);
  await expect(page.getByRole("button", { name: "Feuille précédente" })).toBeDisabled();
  // Opened from an address, the viewer's back opens the list in its place.
  await page.getByRole("button", { name: "Retour aux plans" }).click();
  await expect(page).toHaveURL(LIST_PATH);
  await context.close();
});

test("an older revision says it is replaced and leads to the one in force", async ({ browser }) => {
  const context = await signedIn(browser, "foreman");
  const page = await context.newPage();
  await page.goto(LIST_PATH);
  await page.waitForLoadState("networkidle");
  // Each window ignores taps for a moment after it opens.
  await page.getByRole("button", { name: "Gérer la feuille C-101" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Révisions/ }).click();
  await expect(page.getByRole("link", { name: "Ouvrir" })).toHaveCount(2);
  await page.waitForTimeout(400);
  await page.getByRole("link", { name: "Ouvrir" }).nth(1).click();

  await expect(page).toHaveURL(/\?rev=/);
  await sharp(page);
  const banner = page.getByRole("alert").filter({ hasText: "Rév. 0 remplacée" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Voir celle en vigueur" }).click();
  await expect(page).not.toHaveURL(/\?rev=/);
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rév. A, voir les révisions" })).toBeVisible();

  // From the viewer's own list of revisions, and back.
  await page.getByRole("button", { name: "Rév. A, voir les révisions" }).click();
  const window = page.getByRole("dialog", { name: "Révisions de C-101" });
  await expect(window.getByText("En vigueur")).toBeVisible();
  await page.waitForTimeout(400);
  await window.getByRole("button", { name: /Rév\. 0/ }).click();
  await expect(page).toHaveURL(/\?rev=/);
  await expect(banner).toBeVisible();
  await sharp(page);
  await banner.getByRole("button", { name: "Voir celle en vigueur" }).click();
  await expect(page).not.toHaveURL(/\?rev=/);

  // A revision the sheet does not have.
  await page.goto(`${SHEET_PATH}/${seed.sheetIds[1]}?rev=inconnue`);
  await expect(page.getByRole("heading", { name: "Révision introuvable" })).toBeVisible();
  await page.getByRole("button", { name: "Voir la révision en vigueur" }).click();
  await sharp(page);
  await context.close();
});

test("a sheet that does not exist, or was archived meanwhile, says so with a way back", async ({
  browser,
}) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  await page.goto(`${SHEET_PATH}/inconnue`);
  await expect(page.getByRole("heading", { name: "Feuille introuvable" })).toBeVisible();
  await page.getByRole("button", { name: "Retour aux plans" }).first().click();
  await expect(page).toHaveURL(LIST_PATH);

  // The device holds the sheet: it was opened, and the app keeps what it saw.
  const plans = await livePlans(context);
  const gone = plans.sheets[plans.sheets.length - 1];
  await page.goto(`${SHEET_PATH}/${gone.id}`);
  await sharp(page);
  await page.waitForTimeout(1500);
  const office = await contextAs(browser, "admin");
  expect((await call(office.request, "DELETE", `/api/sheets/${gone.id}`)).status).toBe(200);
  await office.close();

  await page.goto(`${SHEET_PATH}/${gone.id}`);
  await expect(page.getByRole("heading", { name: "Feuille introuvable" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.getByRole("button", { name: "Retour aux plans" }).first().click();
  await expect(page).toHaveURL(LIST_PATH);
  await expect(page.getByRole("link", { name: new RegExp(gone.number) })).toHaveCount(0);
  await context.close();
});

test("the people of the project open its sheets; nobody else does", async ({
  browser,
  baseURL,
}) => {
  const sheetId = seed.sheetIds[1];
  for (const role of ["worker", "foreman", "admin"] as const) {
    const context = await signedIn(browser, role);
    const page = await context.newPage();
    await page.goto(`${SHEET_PATH}/${sheetId}`);
    await expect(page.getByRole("heading", { level: 1, name: "C-101" })).toBeVisible();
    await sharp(page);
    await context.close();
  }

  // A worker of another project.
  const office = await contextAs(browser, "admin");
  const stranger = await post<{ invite: { url: string } }>(office.request, "/api/users", {
    name: `Essai Visionneuse ${test.info().project.name}`,
    role: "travailleur",
    projectIds: [seed.otherProjectIds[0]],
  });
  await office.close();
  const strangerApi = await api.newContext({ baseURL });
  await post(strangerApi, `/api/invites/${new URL(stranger.invite.url).pathname.split("/i/")[1]}`);
  expect((await call(strangerApi, "GET", `/api/sheets/${sheetId}`)).status).toBe(404);
  expect((await call(strangerApi, "GET", `/api/projects/${seed.projectId}/plans`)).status).toBe(
    404,
  );
  const context = await browser.newContext({
    ...device(),
    storageState: await strangerApi.storageState(),
  });
  await strangerApi.dispose();
  const page = await context.newPage();
  await page.goto(`${SHEET_PATH}/${sheetId}`);
  await expect(page.getByRole("heading", { name: "Projet introuvable" })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await context.close();

  // Signed out.
  const nobody = await browser.newContext(device());
  const outside = await nobody.newPage();
  await outside.goto(`${SHEET_PATH}/${sheetId}`);
  await expect(outside).toHaveURL(/\/bienvenue/);
  expect((await call(nobody.request, "GET", `/api/sheets/${sheetId}`)).status).toBe(401);
  await nobody.close();
});

test("thirty sheets in a row leave no viewer behind", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  const plans = await livePlans(context);
  const cdp = await context.newCDPSession(page);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(300);
    await cdp.send("HeapProfiler.collectGarbage");
    return (await cdp.send("Runtime.getHeapUsage")).usedSize;
  };

  // A viewer left alive keeps drawing: animation frames asked for by the
  // page, counted over a second, tell whether one is still running.
  await page.addInitScript(() => {
    const ask = window.requestAnimationFrame.bind(window);
    const counted = window as unknown as { frames: number };
    counted.frames = 0;
    window.requestAnimationFrame = (callback) => {
      counted.frames++;
      return ask(callback);
    };
  });
  const framesPerSecond = async () => {
    const before = await page.evaluate(() => (window as unknown as { frames: number }).frames);
    await page.waitForTimeout(1000);
    return (await page.evaluate(() => (window as unknown as { frames: number }).frames)) - before;
  };

  await page.goto(LIST_PATH);
  await expect(page.getByRole("link", { name: /C-101/ }).first()).toBeVisible();
  const idle = await framesPerSecond();
  let early = 0;
  for (let visit = 1; visit <= 30; visit++) {
    const sheet = plans.sheets[visit % plans.sheets.length];
    await page
      .getByRole("link", { name: new RegExp(sheet.number) })
      .first()
      .click();
    await sharp(page);
    if (visit % 3 === 0) {
      // Turned to the next sheet inside the viewer, now and then.
      const next = page.getByRole("button", { name: "Feuille suivante" });
      if (await next.isEnabled()) {
        await next.click();
        await expect(viewer(page)).toHaveAttribute("data-tiles", /sharp|partial/);
      }
    }
    await page.getByRole("button", { name: "Retour aux plans" }).click();
    await expect(page).toHaveURL(LIST_PATH);
    await expect(page.locator("canvas, .openseadragon-container")).toHaveCount(0);
    if (visit === 5) early = await heap();
  }
  const late = await heap();
  const after = await framesPerSecond();
  report("animation frames per second on the list, before and after", `${idle}, ${after}`);
  expect(after).toBeLessThanOrEqual(idle + 5);
  report("JS heap after 5 sheets (MB)", (early / 1e6).toFixed(1));
  report("JS heap after 30 sheets (MB)", (late / 1e6).toFixed(1));
  expect(late - early).toBeLessThan(8_000_000);
  await context.close();
});

test("without a network a listed sheet opens from the device; an unknown one says so", async ({
  browser,
}) => {
  const context = await signedIn(browser, "worker", "allow");
  const page = await context.newPage();
  await page.goto(LIST_PATH);
  // The service worker takes the page, stores the app, then the list again
  // through it, with its thumbnails.
  await expect
    .poll(() => page.evaluate(async () => Boolean(await caches.match("/"))), { timeout: 30_000 })
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("link", { name: /C-102/ }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole("link", { name: /C-102/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "C-102" })).toBeVisible();
  // The thumbnail is drawn; the sharp tiles were never on this device.
  await expect
    .poll(() =>
      page
        .locator("[data-tiles] [role=img] img")
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
        .catch(() => false),
    )
    .toBe(true);
  await expect(page.getByText("Ce plan n'est pas encore sur cet appareil")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retour aux plans" })).toBeVisible();

  await page.goto(`${SHEET_PATH}/inconnue`);
  await expect(page.getByRole("heading", { name: "Pas de réseau" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retour aux plans" })).toBeVisible();

  // The network is back: the sheet sharpens by itself.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "C-102" })).toBeVisible();
  await context.setOffline(false);
  await sharp(page);
  await context.close();
});

test("the counter opens the whole set: any sheet is one search and one tap away", async ({
  browser,
}) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  const plans = await livePlans(context);
  const from = plans.sheets.find((one) => one.number === "C-101")!;
  const to = plans.sheets.find((one) => one.number === "C-301")!;

  await page.goto(`${SHEET_PATH}/${from.id}`);
  await sharp(page);
  await counter(page).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("heading", { name: "Choisir une feuille" })).toBeVisible();
  // The sheet on screen is marked in the list: one card, a row per sheet.
  await expect(picker.locator('[aria-current="true"]')).toContainText("C-101");
  await expect(picker.getByRole("list")).toHaveCount(1);
  await expect(picker.getByRole("listitem")).toHaveCount(plans.sheets.length);

  await picker.getByPlaceholder("Numéro ou titre").fill("c3");
  const found = picker.getByRole("button", { name: /C-301/ });
  await expect(found).toBeVisible();
  await expect(picker.getByRole("button", { name: /C-101/ })).toHaveCount(0);
  // A window ignores taps for a moment after it opens, against double taps.
  await page.waitForTimeout(450);
  await found.click();

  await expect(picker).toBeHidden();
  await expect(page).toHaveURL(`${SHEET_PATH}/${to.id}`);
  await sharp(page);
  // Sheets take each other's place: back leaves the viewer in one step.
  await page.getByRole("button", { name: "Retour aux plans" }).click();
  await expect(page).toHaveURL(LIST_PATH);
  await context.close();
});

test("a revision added this week stands out in the list, and only then", async ({ browser }) => {
  const context = await signedIn(browser, "worker");
  const page = await context.newPage();
  await page.goto(LIST_PATH);
  // C-101 got its revision A in this run: new, in blue.
  const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: /C-101/ }) });
  await expect(row.getByText("Rév. A")).toBeVisible();
  await expect(row.getByText("· nouvelle")).toBeVisible();
  const colour = await row.getByText("· nouvelle").evaluate((node) => getComputedStyle(node).color);
  expect(colour).toBe("rgb(34, 105, 149)");
  await context.close();
});

test("on the narrowest phone the bars hold: whole title, large sheet turning, revision button", async ({
  browser,
}) => {
  test.skip(!device().isMobile, "The phone's bars");
  const context = await contextAs(browser, "worker", {
    ...device(),
    viewport: { width: 360, height: 740 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const plans = await livePlans(context);
  const sheet = plans.sheets.find((one) => one.number === "C-102")!;
  await page.goto(`${SHEET_PATH}/${sheet.id}`);
  await sharp(page);

  // The title, chainage included, on two lines under the number.
  const title = topBar(page).getByText(sheet.title, { exact: true });
  await expect(title).toBeVisible();
  expect(await title.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);

  // Turning sheets is done all day: larger targets. "Réduire" gives way.
  for (const name of ["Feuille précédente", "Feuille suivante"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.width).toBeGreaterThanOrEqual(48);
  }
  expect((await counter(page).boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await expect(page.getByRole("button", { name: "Réduire" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Tourner d'un quart de tour" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  // The revision is a button that opens the revisions.
  const revision = page.getByRole("button", { name: /voir les révisions$/ });
  expect((await revision.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await revision.click();
  const window = page.getByRole("dialog", { name: "Révisions de C-102" });
  await expect(window).toBeVisible();
  await expect(window.locator('[aria-current="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(window).toBeHidden();

  // Sideways, the top bar is one slim line: number · title.
  await page.setViewportSize({ width: 740, height: 360 });
  await expect.poll(async () => (await topBar(page).boundingBox())!.height).toBeLessThanOrEqual(48);
  const number = (await topBar(page).getByRole("heading", { level: 1 }).boundingBox())!;
  const line = (await title.boundingBox())!;
  expect(Math.abs(number.y + number.height / 2 - (line.y + line.height / 2))).toBeLessThan(6);
  await context.close();
});
