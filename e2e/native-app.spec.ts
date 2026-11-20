import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  answerNative,
  asNativeApp,
  CACHES,
  emitNative,
  nativeCalls,
  openedByLink,
  type NativeCall,
} from "./nativeweb-support";
import { call, contextAs, post, seed, type Role } from "./support";

// The pages inside the iPhone app (a Capacitor shell around the site), with
// the shell's real bridge script and a fake native side: the app knows where
// it runs, offers no install card, opens files in the system's viewer and
// shares them through the share sheet, never through a tab or a download it
// cannot do there, and follows the links that open it. The same screens in a
// browser stay as they were.

const phone = () => test.info().project.name === "phone";

/** Safari on an iPhone, as the web view inside the app also calls itself. */
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

async function device(
  browser: Parameters<typeof contextAs>[0],
  role: Role,
  inApp: boolean,
): Promise<BrowserContext> {
  const context = await contextAs(browser, role, { userAgent: IPHONE });
  if (inApp) await asNativeApp(context);
  return context;
}

/** Waits for the page to have called a plugin's method, and gives the calls so far. */
async function called(page: Page, pluginId: string, methodName: string): Promise<NativeCall[]> {
  await expect
    .poll(async () =>
      (await nativeCalls(page)).some(
        (call) => call.pluginId === pluginId && call.methodName === methodName,
      ),
    )
    .toBe(true);
  return nativeCalls(page);
}

const find = (calls: NativeCall[], pluginId: string, methodName: string) =>
  calls.filter((call) => call.pluginId === pluginId && call.methodName === methodName);

/** What the fake native side answers a writeFile with. */
const uriOf = (write: NativeCall) =>
  CACHES + String(write.options.path).split("/").map(encodeURIComponent).join("/");

async function seededReport(context: BrowserContext) {
  const list = await call<{ id: string; day: string }[]>(
    context.request,
    "GET",
    `/api/projects/${seed.projectId}/reports`,
  );
  return list.body[0];
}

test("inside the app: it knows, hides the launch screen and offers no install card", async ({
  browser,
}) => {
  const context = await device(browser, "foreman", true);
  const page = await context.newPage();
  await page.goto("/moi");
  await expect(page.getByRole("heading", { name: "Mon compte", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as { Capacitor?: { isNativePlatform(): boolean } }).Capacitor?.isNativePlatform(),
    ),
  ).toBe(true);
  // The launch screen goes once the page has drawn; the links that open the app are heard.
  const calls = await called(page, "SplashScreen", "hide");
  expect(find(calls, "App", "addListener")[0]?.options).toEqual({ eventName: "appUrlOpen" });
  await expect(page.getByText("Se déconnecter")).toBeVisible();
  // The shell's "launch address" is only the last link received: never asked.
  expect(find(await nativeCalls(page), "App", "getLaunchUrl")).toEqual([]);
  await expect(page.getByRole("heading", { name: "Installer l'application" })).toHaveCount(0);
  await context.close();
});

test("inside the app: the report's PDF opens in the viewer and goes to the share sheet", async ({
  browser,
}) => {
  const context = await device(browser, "foreman", true);
  const report = await seededReport(context);
  const page = await context.newPage();
  let tabs = 0;
  context.on("page", () => (tabs += 1));
  await page.goto(`/projets/${seed.projectId}/rapports/${report.id}`);
  await expect(page.getByRole("heading", { name: "Rapport journalier" })).toBeVisible();
  // Nothing on the screen opens a tab, which the shell would hand to Safari.
  await expect(page.locator('a[target="_blank"]')).toHaveCount(0);

  const name = new RegExp(`^ead-fichiers/[\\w-]+/Rapport journalier 24-118 ${report.day}\\.pdf$`);
  if (phone()) {
    await page.getByRole("button", { name: "PDF" }).click();
    const sheet = page.getByRole("dialog", { name: "PDF du rapport" });
    await expect(sheet.getByRole("button", { name: "Partager" })).toBeVisible();
    // No download, no tab: a button that does nothing in the app is not offered.
    await expect(sheet.getByRole("link")).toHaveCount(0);
    await expect(sheet.getByText("Télécharger")).toHaveCount(0);
    // A window ignores taps for a moment after it opens (a double tap must not answer it).
    await page.waitForTimeout(450);
    await sheet.getByRole("button", { name: "Ouvrir" }).click();
  } else {
    // A computer-wide screen (an iPad): the header's PDF opens it straight.
    await page.getByRole("button", { name: "PDF" }).click();
  }
  let calls = await called(page, "FileViewer", "openDocumentFromLocalPath");
  const [write] = find(calls, "Filesystem", "writeFile");
  expect(write.options).toMatchObject({ directory: "CACHE", recursive: true });
  expect(write.options.path).toMatch(name);
  expect(Buffer.from(String(write.options.data), "base64").subarray(0, 5).toString()).toBe("%PDF-");
  const [open] = find(calls, "FileViewer", "openDocumentFromLocalPath");
  expect(open.options).toEqual({ path: uriOf(write) });

  if (phone()) {
    // Sharing hands the same file to the shell's share sheet (Chromium's web view has none).
    await page
      .getByRole("dialog", { name: "PDF du rapport" })
      .getByRole("button", { name: "Partager" })
      .click();
    calls = await called(page, "Share", "share");
    const writes = find(calls, "Filesystem", "writeFile");
    expect(writes).toHaveLength(2);
    expect(find(calls, "Share", "share")[0].options).toMatchObject({
      files: [uriOf(writes[1])],
      title: expect.stringMatching(/^Rapport journalier 24-118 /),
    });
  }
  expect(tabs).toBe(0);
  await context.close();
});

test("inside the app: a document opens through the viewer", async ({ browser }) => {
  const context = await device(browser, "foreman", true);
  const page = await context.newPage();
  let tabs = 0;
  context.on("page", () => (tabs += 1));
  await page.goto(`/projets/${seed.projectId}/documents`);
  const title = "Programme de prévention (exemple)";
  await page.getByRole("listitem").filter({ hasText: title }).getByRole("button").first().click();
  const calls = await called(page, "FileViewer", "openDocumentFromLocalPath");
  const [write] = find(calls, "Filesystem", "writeFile");
  expect(write.options.path).toMatch(
    /^ead-fichiers\/[\w-]+\/Programme de prévention \(exemple\)\.pdf$/,
  );
  expect(Buffer.from(String(write.options.data), "base64").subarray(0, 5).toString()).toBe("%PDF-");
  expect(find(calls, "FileViewer", "openDocumentFromLocalPath")[0].options).toEqual({
    path: uriOf(write),
  });
  expect(tabs).toBe(0);
  await context.close();
});

test("inside the app: a link that opens it takes it to that screen", async ({ browser }) => {
  const context = await device(browser, "foreman", true);
  const page = await context.newPage();
  await page.goto("/");
  await called(page, "App", "addListener");
  const documents = `/projets/${seed.projectId}/documents`;
  await emitNative(page, "App", "appUrlOpen", {
    url: `https://ead-chantier.vercel.app${documents}`,
  });
  await expect(page).toHaveURL(documents);
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();

  // Its own address on this server too, with what follows the path.
  const photos = `/projets/${seed.projectId}/photos`;
  await emitNative(page, "App", "appUrlOpen", { url: new URL(photos, seed.base).href });
  await expect(page).toHaveURL(photos);

  // Another site's address is not the app's to open.
  await emitNative(page, "App", "appUrlOpen", { url: "https://exemple.com/projets/x" });
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(photos);
  await context.close();
});

test("inside the app: the link it was opened with is followed once, never after a reload", async ({
  browser,
}) => {
  const context = await device(browser, "foreman", true);
  const documents = `/projets/${seed.projectId}/documents`;
  await openedByLink(context, `https://ead-chantier.vercel.app${documents}`);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(documents);
  await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();

  // A full load, as entering the app after an invitation, an update or signing out does.
  await page.goto("/moi");
  await expect(page.getByRole("heading", { name: "Mon compte", exact: true })).toBeVisible();
  await called(page, "App", "addListener");
  await page.waitForTimeout(500);
  await expect(page).toHaveURL("/moi");
  await page.reload();
  await called(page, "App", "addListener");
  await page.waitForTimeout(500);
  await expect(page).toHaveURL("/moi");
  await context.close();
});

test("inside the app: a photo goes to the share sheet, and a refused sheet says so", async ({
  browser,
}) => {
  const context = await device(browser, "foreman", true);
  const photos = (
    await call<{ id: string }[]>(context.request, "GET", `/api/projects/${seed.projectId}/photos`)
  ).body;
  const page = await context.newPage();
  await page.goto(`/projets/${seed.projectId}/photos?photo=${photos[0].id}`);
  const viewer = page.getByRole("dialog", { name: "Photo en grand" });
  await expect(viewer.getByRole("button", { name: "Télécharger" })).toHaveCount(0);
  await answerNative(page, "Share.share", {
    error: { message: "Can't share while sharing is in progress" },
  });
  await viewer.getByRole("button", { name: "Partager" }).click();
  const share = find(await called(page, "Share", "share"), "Share", "share")[0];
  expect(share.options.files).toEqual([expect.stringMatching(/^file:\/\/.*\.jpg$/)]);
  // The image was in hand: the message is about the sheet, never the network.
  await expect(page.getByText("Le partage n'a pas abouti. Réessayez.")).toBeVisible();
  await expect(page.getByText(/Vérifiez le réseau/)).toHaveCount(0);
  await context.close();
});

test("inside the app: the QR poster is shared, never printed", async ({ browser }) => {
  const context = await device(browser, "admin", true);
  const page = await context.newPage();
  await page.goto(`/projets/${seed.projectId}/equipe`);
  await page
    .getByRole("button", { name: "Code QR du chantier" })
    .filter({ visible: true })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Code QR du chantier" });
  await expect(sheet.getByRole("button", { name: "Partager" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Imprimer/ })).toHaveCount(0);
  // A window ignores taps for a moment after it opens (a double tap must not answer it).
  await page.waitForTimeout(450);
  await sheet.getByRole("button", { name: "Partager" }).click();
  const calls = await called(page, "Share", "share");
  expect(find(calls, "Share", "share")[0].options).toMatchObject({
    url: expect.stringMatching(/\/j\/\w+/),
  });
  await context.close();
});

test("inside the app: a personal invitation goes to the share sheet; a browser keeps its own", async ({
  browser,
}) => {
  for (const inApp of [true, false]) {
    const context = await device(browser, "admin", inApp);
    // The browser's own sharing, recorded: the app must not use it.
    await context.addInitScript(() => {
      const shared: unknown[] = [];
      (window as { webShared?: unknown[] }).webShared = shared;
      Object.defineProperty(Navigator.prototype, "share", {
        configurable: true,
        value: async (data: unknown) => void shared.push(data),
      });
    });
    const person = await post<{ id: string }>(context.request, "/api/users", {
      name: `Essai Partage ${test.info().project.name} ${inApp ? "app" : "site"}`,
      role: "travailleur",
      projectIds: [],
    });
    const page = await context.newPage();
    await page.goto(`/equipe?personne=${person.id}`);
    await page.getByRole("button", { name: "Créer un nouveau lien" }).click();
    const sheet = page.getByRole("dialog", { name: /^Nouveau lien pour/ });
    await expect(sheet.getByRole("button", { name: "Partager autrement" })).toBeVisible();
    // A window ignores taps for a moment after it opens.
    await page.waitForTimeout(450);
    await sheet.getByRole("button", { name: "Partager autrement" }).click();
    const webShared = () => page.evaluate(() => (window as { webShared?: unknown[] }).webShared);
    if (inApp) {
      const calls = await called(page, "Share", "share");
      expect(find(calls, "Share", "share")[0].options).toMatchObject({
        text: expect.stringMatching(/\/i\/\w+/),
      });
      expect(await webShared()).toEqual([]);
    } else {
      await expect
        .poll(webShared)
        .toEqual([{ title: expect.any(String), text: expect.stringMatching(/\/i\/\w+/) }]);
    }
    await call(context.request, "PATCH", `/api/users/${person.id}`, { active: false });
    await context.close();
  }
});

test("inside the app without the offline worker: the project says plainly what it cannot keep", async ({
  browser,
}) => {
  const context = await device(browser, "foreman", true);
  // A web view outside its App-Bound Domains has no service workers.
  await context.addInitScript(() => {
    delete (Navigator.prototype as { serviceWorker?: unknown }).serviceWorker;
  });
  const page = await context.newPage();
  await page.goto(`/projets/${seed.projectId}`);
  await expect(
    page.getByRole("heading", { name: "Plans sans réseau indisponibles" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Garder sur cet appareil" })).toHaveCount(0);
  // The diagnostic says it too, with the plugins that answer.
  await page.goto("/diagnostic");
  await expect(page.locator('[data-diagnostic="Dans l\'application iPhone"]')).toHaveText("Oui");
  await expect(page.locator('[data-diagnostic="Mode hors ligne"]')).toHaveText(
    "Non disponible ici",
  );
  const modules = page.locator('[data-diagnostic="Modules de l\'application"]');
  for (const name of ["App", "Share", "Filesystem", "FileViewer", "SplashScreen"])
    await expect(modules).toContainText(`${name}\u00a0: répond`);
  // In the person's words, never the plugin's.
  await expect(modules).toContainText("Filesystem\u00a0: répond (autorisé)");
  await expect(modules).not.toContainText("granted");
  await context.close();
});

test("in a browser, the same screens are unchanged", async ({ browser }) => {
  const context = await device(browser, "foreman", false);
  const report = await seededReport(context);
  const page = await context.newPage();
  await page.goto("/moi");
  await expect(page.getByRole("heading", { name: "Installer l'application" })).toBeVisible();

  await page.goto(`/projets/${seed.projectId}/rapports/${report.id}`);
  const pdfPath = `/api/reports/${report.id}/pdf`;
  if (phone()) {
    await page.getByRole("button", { name: "PDF" }).click();
    const sheet = page.getByRole("dialog", { name: "PDF du rapport" });
    await expect(sheet.getByRole("link", { name: "Ouvrir" })).toHaveAttribute("href", pdfPath);
    await expect(sheet.getByRole("link", { name: "Ouvrir" })).toHaveAttribute("target", "_blank");
    await expect(sheet.getByRole("link", { name: "Télécharger" })).toHaveAttribute(
      "href",
      `${pdfPath}?download`,
    );
    await page.keyboard.press("Escape");
  } else {
    const link = page.getByRole("link", { name: "PDF" });
    await expect(link).toHaveAttribute("href", pdfPath);
    await expect(link).toHaveAttribute("target", "_blank");
  }

  // A document opens in a tab of its own.
  await page.goto(`/projets/${seed.projectId}/documents`);
  const tab = context.waitForEvent("page");
  await page
    .getByRole("listitem")
    .filter({ hasText: "Programme de prévention (exemple)" })
    .getByRole("button")
    .first()
    .click();
  await (await tab).close();

  await page.goto(`/projets/${seed.projectId}`);
  await expect(page.getByRole("link", { name: "Itinéraire" })).toHaveAttribute(
    "href",
    /^https:\/\/www\.google\.com\/maps\/dir\//,
  );
  await page.goto("/diagnostic");
  await expect(page.locator('[data-diagnostic="Dans l\'application iPhone"]')).toHaveText("Non");
  // No plugin code was ever loaded: @capacitor/core would have set this global.
  expect(await page.evaluate(() => "Capacitor" in window)).toBe(false);
  await context.close();

  // The office still prints the QR poster.
  const office = await device(browser, "admin", false);
  const team = await office.newPage();
  await team.goto(`/projets/${seed.projectId}/equipe`);
  await team
    .getByRole("button", { name: "Code QR du chantier" })
    .filter({ visible: true })
    .first()
    .click();
  await expect(
    team
      .getByRole("dialog", { name: "Code QR du chantier" })
      .getByRole("button", { name: /Imprimer/ }),
  ).toBeVisible();
  await office.close();
});

test("inside the app: directions leave for the iPhone's own maps", async ({ browser }) => {
  const context = await device(browser, "foreman", true);
  const page = await context.newPage();
  await page.goto(`/projets/${seed.projectId}`);
  await expect(page.getByRole("link", { name: "Itinéraire" })).toHaveAttribute(
    "href",
    /^https:\/\/maps\.apple\.com\/\?daddr=/,
  );
  await context.close();
});
