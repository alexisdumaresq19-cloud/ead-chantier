/**
 * The App Store screenshots: the real app, drawn by Chromium at the size and
 * scale of two iPhones, with the sample data only, signed in as the sample
 * foreman. Each PNG is the screen as the phone shows it: the iPhone's status
 * bar over the app's black header, the home indicator at the bottom, no frame.
 *
 *   npm run db:fresh, then a server on that database (a production build:
 *   the development one draws its own badge; with the environment
 *   scripts/e2e.sh sets, and the same SETUP_CODE given to the seed), then
 *   BASE=http://localhost:3265 npm run seed
 *   BASE=http://localhost:3265 npx tsx scripts/store-sample.mts
 *   BASE=http://localhost:3265 npx tsx scripts/store-screenshots.mts
 *
 * Chromium has no notch: env(safe-area-inset-*) is always 0 there. The app's
 * stylesheets are therefore given, as they are fetched, the insets the iPhone
 * gives the web view, so that the app lays itself out exactly as it does on
 * the phone (its header under the status bar, its tabs above the home
 * indicator); the status bar and the indicator are then drawn in those bands.
 *
 * Writes store/screenshots/6.9/*.png (1320x2868) and store/screenshots/6.3/*.png
 * (1206x2622), RGB without alpha, as App Store Connect wants them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in a dev script */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";

import { chromium, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3265";
const SEED = process.env.SEED_OUT ?? ".data/dev";
const OUT = "store/screenshots";

/** Points, scale, and the safe area of the two iPhones App Store Connect asks for. */
const DEVICES = [
  // iPhone 16 Pro Max and 17 Pro Max: 1320x2868.
  { folder: "6.9", width: 440, height: 956, top: 62, bottom: 34 },
  // iPhone 16 Pro and 17 Pro: 1206x2622.
  { folder: "6.3", width: 402, height: 874, top: 62, bottom: 34 },
] as const;
type Device = (typeof DEVICES)[number];

const seed = JSON.parse(readFileSync(`${SEED}/seed.json`, "utf8"));
const projectId: string = seed.projectId;

/** The stylesheets as the iPhone would read them, with its insets in place of env(). */
async function withInsets(context: BrowserContext, device: Device) {
  await context.route(/\.css(\?|$)/, async (route) => {
    const response = await route.fetch();
    const css = (await response.text())
      .replaceAll("env(safe-area-inset-top)", `${device.top}px`)
      .replaceAll("env(safe-area-inset-bottom)", `${device.bottom}px`)
      .replaceAll("env(safe-area-inset-left)", "0px")
      .replaceAll("env(safe-area-inset-right)", "0px");
    await route.fulfill({ response, body: css });
  });
}

/**
 * The iPhone's own bands, drawn in the places the insets left free. iOS draws
 * them above the web view, so above the app's windows too: they go in the
 * top layer, shown after any open dialog.
 */
async function drawPhoneBands(page: Page, device: Device, bands: Bands) {
  await page.evaluate(
    ({ width, top, status, indicator }) => {
      const layer = document.createElement("div");
      layer.popover = "manual";
      layer.style.cssText =
        "inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none";
      // The left and right ears, beside where the Dynamic Island sits.
      const ear = (width - 126) / 2;
      layer.innerHTML = `
        <div style="position:absolute;inset:0 0 auto 0;height:${top}px;color:${status};font:600 17px/1 var(--font-inter),sans-serif;letter-spacing:-0.3px">
          <span style="position:absolute;left:0;width:${ear}px;top:0;height:${top - 4}px;display:flex;align-items:center;justify-content:center;padding-left:14px">9:41</span>
          <span style="position:absolute;right:0;width:${ear}px;top:0;height:${top - 4}px;display:flex;align-items:center;justify-content:center;gap:6px;padding-right:12px">
            <svg width="19" height="12" viewBox="0 0 19 12" fill="currentColor" aria-hidden="true">
              <rect x="0" y="7.5" width="3.2" height="4.5" rx="1"/>
              <rect x="5" y="5" width="3.2" height="7" rx="1"/>
              <rect x="10" y="2.5" width="3.2" height="9.5" rx="1"/>
              <rect x="15" y="0" width="3.2" height="12" rx="1"/>
            </svg>
            <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor" aria-hidden="true">
              <path d="M8.5 2.3c2.5 0 4.8 1 6.5 2.6.2.2.5.2.7 0l1.2-1.2c.2-.2.2-.5 0-.7C14.7.9 11.7-.3 8.5-.3S2.3.9.1 3c-.2.2-.2.5 0 .7l1.2 1.2c.2.2.5.2.7 0C3.7 3.3 6 2.3 8.5 2.3z"/>
              <path d="M8.5 6.1c1.4 0 2.7.5 3.7 1.4.2.2.5.2.7 0l1.2-1.2c.2-.2.2-.5 0-.7-1.5-1.3-3.5-2.1-5.6-2.1s-4.1.8-5.6 2.1c-.2.2-.2.5 0 .7l1.2 1.2c.2.2.5.2.7 0 1-.9 2.3-1.4 3.7-1.4z"/>
              <path d="M11.1 9.2c.2-.2.2-.5 0-.7-.7-.6-1.6-.9-2.6-.9s-1.9.3-2.6.9c-.2.2-.2.5 0 .7l2.3 2.3c.2.2.4.2.6 0l2.3-2.3z"/>
            </svg>
            <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true">
              <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" stroke-opacity="0.4"/>
              <rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor"/>
              <path d="M25 4.4v4.2c.8-.3 1.4-1.1 1.4-2.1s-.6-1.8-1.4-2.1z" fill="currentColor" fill-opacity="0.45"/>
            </svg>
          </span>
        </div>
        <div style="position:absolute;left:50%;bottom:8px;width:139px;height:5px;margin-left:-69.5px;border-radius:3px;background:${indicator}"></div>`;
      document.body.append(layer);
      layer.showPopover();
    },
    { width: device.width, top: device.top, ...bands },
  );
}

/**
 * The bars at the bottom (the tabs, a screen's own action bar) are 95 %
 * opaque over a blur, as on iOS: what scrolls beneath them shows through as a
 * faint smudge, which on a still picture reads as a flaw (a ghost row of text
 * under the tabs). What lies wholly beneath them cannot be read on the phone
 * anyway: it is hidden, and the bars keep their own look. `cut` names the
 * parts of a document that are hidden whole when the bars cut them, so that
 * a page does not end on half a heading.
 */
async function clearUnderBars(page: Page, cut?: string) {
  await page.evaluate((cut) => {
    // The sidebar's list bears the same name: the tabs are the one fixed to the bottom.
    const tabs = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Navigation"]')].find(
      (nav) => getComputedStyle(nav).position === "fixed" && nav.getBoundingClientRect().height > 0,
    );
    if (!tabs) return;
    const tabsTop = tabs.getBoundingClientRect().top;
    // A screen's own bar sits on the tabs (bottom: var(--ead-tabs)), fixed or stuck there.
    const bars = [...document.querySelectorAll<HTMLElement>("main *")].filter((element) => {
      const box = element.getBoundingClientRect();
      return (
        ["fixed", "sticky"].includes(getComputedStyle(element).position) &&
        box.height > 0 &&
        box.height < 200 &&
        Math.abs(box.bottom - tabsTop) < 2
      );
    });
    const top = Math.min(tabsTop, ...bars.map((bar) => bar.getBoundingClientRect().top));
    for (const element of document.querySelectorAll<HTMLElement>("main *")) {
      if (bars.some((bar) => bar.contains(element))) continue;
      const box = element.getBoundingClientRect();
      const cutPart = cut !== undefined && element.matches(cut) && box.bottom > top;
      if (box.top >= top || cutPart) element.style.visibility = "hidden";
    }
  }, cut);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Images (plan tiles, photos) decoded, fonts in, animations over.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) => (image.complete ? null : image.decode().catch(() => {}))),
    );
  });
  await page.waitForTimeout(700);
}

async function save(page: Page, device: Device, name: string, plainBand: boolean) {
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  const file = `${OUT}/${device.folder}/${name}.png`;
  // App Store Connect refuses an image with an alpha channel.
  await sharp(png).removeAlpha().png({ compressionLevel: 9 }).toFile(file);
  const meta = await sharp(file).metadata();
  if (meta.width !== device.width * 3 || meta.height !== device.height * 3 || meta.channels !== 3)
    throw new Error(`${file}\u00a0: ${meta.width}x${meta.height}, ${meta.channels} canaux`);
  if (plainBand) await assertPlainHomeBand(file, device);
  console.log(`${file}  ${meta.width}x${meta.height}  ${meta.channels} canaux`);
}

/**
 * Beside the home indicator, the band at the bottom shows only the bar's own
 * colour: anything else is the page showing through (the ghost row a review
 * found once, 5 to 7 levels off). The indicator itself, in the middle, is
 * left out, and so are screens with a see-through bar of their own (the plan).
 */
async function assertPlainHomeBand(file: string, device: Device) {
  const top = (device.height - device.bottom + 4) * 3;
  const { data, info } = await sharp(file)
    .extract({ left: 0, top, width: device.width * 3, height: device.height * 3 - top })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const middle = [(device.width / 2 - 90) * 3, (device.width / 2 + 90) * 3];
  let worst = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (x > middle[0] && x < middle[1]) continue;
      const at = (y * info.width + x) * info.channels;
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(data[at + c] - data[c]));
    }
  if (worst > 2)
    throw new Error(`${file}\u00a0: la page paraît sous la barre du bas (écart ${worst})`);
}

/** The colours of the status bar's glyphs and of the home indicator, as iOS picks them. */
type Bands = { status: string; indicator: string };
const OVER_HEADER_AND_TABS: Bands = { status: "#fff", indicator: "#000" };
const OVER_DARK: Bands = { status: "#fff", indicator: "#fff" };

type Shot = { name: string; take: (page: Page) => Promise<Bands>; cut?: string };

const api = async (page: Page, path: string) =>
  (await (await page.request.get(BASE + path)).json()) as any;
const sheetNumbered = async (page: Page, number: string) =>
  (await api(page, `/api/projects/${projectId}/plans`)).sheets.find(
    (sheet: any) => sheet.number === number,
  ).id as string;

const SHOTS: Shot[] = [
  {
    // The home as the foreman finds it in the morning: the sheet she was
    // reading yesterday first, the others she opened lately below.
    name: "1-accueil",
    take: async (page) => {
      for (const number of ["C-401", "C-102", "C-101"]) {
        await page.goto(
          `${BASE}/projets/${projectId}/feuilles/${await sheetNumbered(page, number)}`,
        );
        await settle(page);
      }
      await page.goto(`${BASE}/projets/${projectId}`);
      await settle(page);
      return OVER_HEADER_AND_TABS;
    },
  },
  {
    name: "2-plan",
    take: async (page) => {
      await page.goto(
        `${BASE}/projets/${projectId}/feuilles/${await sheetNumbered(page, "C-101")}`,
      );
      await settle(page);
      // Four steps in: the pipes, their labels and the manholes, as read at the site.
      for (let step = 0; step < 4; step++) await page.keyboard.press("+");
      await settle(page);
      return OVER_DARK;
    },
  },
  {
    name: "3-photos",
    take: async (page) => {
      await page.goto(`${BASE}/projets/${projectId}/photos`);
      await settle(page);
      return OVER_HEADER_AND_TABS;
    },
  },
  {
    // Yesterday's report (scripts/store-sample.mts gave it the day's photos),
    // from its top: the day, the weather and the crew say what it is.
    name: "4-rapport",
    cut: "article section",
    take: async (page) => {
      const reports = await api(page, `/api/projects/${projectId}/reports`);
      const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
        Date.now() - 86_400_000,
      );
      const report = reports.find((one: any) => one.day === yesterday) ?? reports[0];
      await page.goto(`${BASE}/projets/${projectId}/rapports/${report.id}`);
      await settle(page);
      // The page says which day's report it is: its title and date are in view.
      const title = await page.getByRole("heading", { name: "Rapport journalier" }).boundingBox();
      if (!title || title.y > 200)
        throw new Error("4-rapport\u00a0: le titre du rapport est hors de vue");
      return OVER_HEADER_AND_TABS;
    },
  },
  {
    // Today's report: the day's photos chosen, then a few words to the
    // assistant. The microphone is Chromium's own test sound, and AI_FAKE=1
    // answers by fixed rules: no AI service is called.
    name: "5-assistant",
    take: async (page) => {
      await page.goto(`${BASE}/projets/${projectId}/rapports/nouveau`);
      await settle(page);
      await page.getByRole("button", { name: "Photos du jour" }).click();
      const day = page.getByRole("dialog", { name: "Photos du jour" });
      await day.getByRole("button", { name: "Tout choisir" }).click();
      await day.getByRole("button", { name: /^Ajouter \d+ photos?$/ }).click();
      await day.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Dicter le rapport" }).first().click();
      const stop = page.getByRole("button", { name: "Terminer l'enregistrement" });
      await stop.waitFor();
      await page.waitForTimeout(2000);
      await stop.click();
      await page.getByText("C'est noté").waitFor({ timeout: 30_000 });
      // The draft's notice would sit half under the window's top edge: the
      // form behind is scrolled past it, as after a look at the first parts.
      await page.evaluate(() => {
        const notice = [...document.querySelectorAll("main *")].find(
          (element) =>
            element.children.length === 0 && element.textContent?.startsWith("Brouillon gardé"),
        );
        const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
        const box = notice?.closest("div")?.parentElement?.getBoundingClientRect();
        if (box) window.scrollBy(0, box.bottom - header + 12);
      });
      await settle(page);
      const notice = await page
        .getByText("Brouillon gardé", { exact: false })
        .first()
        .boundingBox();
      if (notice && notice.y + notice.height > 120)
        throw new Error("5-assistant\u00a0: l'avis de brouillon paraît derrière la fenêtre");
      return OVER_HEADER_AND_TABS;
    },
  },
  {
    name: "6-documents",
    take: async (page) => {
      await page.goto(`${BASE}/projets/${projectId}/documents`);
      await settle(page);
      return OVER_HEADER_AND_TABS;
    },
  },
];

const only = process.env.ONLY?.split(",");
// As playwright.config.ts: some machines provide one Chromium for every Playwright version.
const sharedChromium = "/opt/pw-browsers/chromium";
const browser = await chromium.launch({
  executablePath:
    process.env.E2E_CHROMIUM ?? (existsSync(sharedChromium) ? sharedChromium : undefined),
  // A microphone that needs nobody, as in the end-to-end tests.
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
try {
  for (const device of DEVICES) {
    if (!only) rmSync(`${OUT}/${device.folder}`, { recursive: true, force: true });
    mkdirSync(`${OUT}/${device.folder}`, { recursive: true });
    for (const shot of SHOTS) {
      if (only && !only.some((name) => shot.name.startsWith(name))) continue;
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        locale: "fr-CA",
        timezoneId: "America/Toronto",
        colorScheme: "light",
        // Route interception does not see what a service worker fetches.
        serviceWorkers: "block",
        permissions: ["microphone"],
        storageState: `${SEED}/foreman.json`,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      });
      await withInsets(context, device);
      const page = await context.newPage();
      const bands = await shot.take(page);
      await clearUnderBars(page, shot.cut);
      await drawPhoneBands(page, device, bands);
      await page.waitForTimeout(100);
      await save(page, device, shot.name, bands !== OVER_DARK);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
