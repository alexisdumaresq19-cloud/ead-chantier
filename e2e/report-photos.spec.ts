import { randomBytes } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";

import { call, contextAs, post, seed } from "./support";

// The photos of a daily report, against the production build: taken from the
// form (the camera in the bottom bar, the phone's gallery), described, saved
// with the report, numbered as its PDF numbers them, counted in the list,
// taken out of the report without leaving the project, chosen among the
// day's photos, kept through a missing network and a clash; then the PDF.
// Each test works in a project of its own.

type Report = { id: string; photoIds: string[]; updatedAt: string };
type Photo = { id: string; caption: string | null };

const siteDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    Date.now() - daysAgo * 86_400_000,
  );

const phone = () => test.info().project.name === "phone";

/** A small JPEG, different each time. */
const jpeg = () =>
  sharp(randomBytes(64 * 48 * 3), { raw: { width: 64, height: 48, channels: 3 } })
    .resize(640, 480, { kernel: "nearest" })
    .jpeg({ quality: 80 })
    .toBuffer();

const idOf = async (who: BrowserContext) => (await call(who.request, "GET", "/api/me")).body.id;

/** A project of the test's own, with the foreman on it; returns its id and a way to leave. */
async function projectWith(office: BrowserContext, foreman: BrowserContext, name: string) {
  const project = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai photos du rapport, ${name} (${test.info().project.name})`,
  });
  const foremanId = await idOf(foreman);
  await post(office.request, `/api/projects/${project.id}/members`, { userIds: [foremanId] });
  return {
    id: project.id,
    leave: () => call(office.request, "DELETE", `/api/projects/${project.id}/members/${foremanId}`),
  };
}

/** A photo sent the way the app sends one: announced, uploaded, then added. */
async function addPhoto(who: BrowserContext, projectId: string, caption: string | null = null) {
  const image = await jpeg();
  const ticket = await post<{ uploadId: string; target: { url: string; headers: object } }>(
    who.request,
    "/api/uploads",
    {
      projectId,
      kind: "photo",
      filename: "chantier.jpg",
      contentType: "image/jpeg",
      size: image.length,
    },
  );
  const sent = await who.request.fetch(new URL(ticket.target.url, seed.base).href, {
    method: "PUT",
    headers: ticket.target.headers as Record<string, string>,
    data: image,
  });
  expect(sent.ok()).toBe(true);
  await post(who.request, `/api/uploads/${ticket.uploadId}/complete`);
  return post<{ id: string }>(who.request, `/api/projects/${projectId}/photos`, {
    uploadId: ticket.uploadId,
    caption,
  });
}

const reportOf = (day: string, photoIds: string[] = []) => ({
  day,
  weather: { condition: "soleil", temperatureC: 12, note: "" },
  crew: [{ name: "Pavage Exemple inc.", hours: 8, userId: null }],
  equipment: "",
  workDone: "Pose de bordures, rue EXEMPLE.",
  notes: "",
  photoIds,
});

const photosOf = async (who: BrowserContext, projectId: string) =>
  (await call<Photo[]>(who.request, "GET", `/api/projects/${projectId}/photos`)).body;
const reportNamed = async (who: BrowserContext, id: string) =>
  (await call<Report>(who.request, "GET", `/api/reports/${id}`)).body;

/** A window ignores taps for a moment after it opens (against double taps). */
async function answer(page: Page, title: string, button: string) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(450);
  await dialog.getByRole("button", { name: button }).click();
}

/** A report's photo tile, by its number (and the start of what it says). */
const tile = (page: Page, number: number, text = "") =>
  page.getByRole("button", { name: new RegExp(`^Photo ${number}\\s:\\s${text}`) });

/** Takes a photo for the report: the bottom bar's camera on a phone, the file picker on a computer. */
async function takePhoto(page: Page) {
  const input = phone()
    ? page.getByLabel("Prendre une photo pour le rapport", { exact: true })
    : page.getByLabel("Ajouter des photos", { exact: true });
  await input.setInputFiles({ name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: await jpeg() });
  await expect(page.getByRole("dialog", { name: "Photo ajoutée" })).toBeVisible();
}

test("photos taken from the form go with the report, numbered, described, and leave it only", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const project = await projectWith(office, foreman, "formulaire");
  const page = await foreman.newPage();
  if (phone()) await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/projets/${project.id}/rapports/nouveau`);
  await expect(page.getByRole("heading", { name: "Nouveau rapport" })).toBeVisible();

  if (phone()) {
    // The camera is in the bar at the bottom, beside "Enregistrer", whatever the scroll.
    const camera = page.locator("label").filter({
      has: page.getByLabel("Prendre une photo pour le rapport", { exact: true }),
    });
    const save = page.getByRole("button", { name: "Enregistrer" });
    for (const target of [camera, save]) {
      const box = (await target.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
  }

  await page.getByLabel("Travaux réalisés").fill("Coffrage du regard R-7.");
  await takePhoto(page);
  await page
    .getByRole("dialog", { name: "Photo ajoutée" })
    .getByLabel("Description")
    .fill("Regard R-7");
  await answer(page, "Photo ajoutée", "Terminé");
  await expect(tile(page, 1, "Regard R-7")).toBeVisible();

  // A second one, from the phone's own photos (or the computer's files).
  await page
    .getByLabel(phone() ? "Choisir dans le téléphone" : "Ajouter des photos", { exact: true })
    .setInputFiles({ name: "IMG_0002.jpg", mimeType: "image/jpeg", buffer: await jpeg() });
  await answer(page, "Photo ajoutée", "Terminé");
  await expect(tile(page, 2)).toBeVisible();
  await expect(page.getByText("Pas encore enregistré.")).toBeVisible();

  // Described from the report: saved at once, for the gallery too.
  await tile(page, 2).click();
  const sheet = page.getByRole("dialog", { name: "Photo 2" });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(450);
  await sheet.getByLabel("Description").fill("Bordure arrachée");
  await sheet.getByRole("button", { name: "Enregistrer la description" }).click();
  await expect(page.getByText("Description enregistrée.")).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect
    .poll(async () => (await photosOf(foreman, project.id)).map((p) => p.caption ?? "").sort())
    .toEqual(["Bordure arrachée", "Regard R-7"]);

  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\/rapports\/(?!nouveau)[a-z0-9]+$/);
  const reportId = page.url().split("/").at(-1) ?? "";
  expect((await reportNamed(foreman, reportId)).photoIds).toHaveLength(2);

  // The saved report: numbered as in the PDF, after the notes, each opening large.
  await expect(tile(page, 1, "Regard R-7")).toBeVisible();
  await expect(tile(page, 2, "Bordure arrachée")).toBeVisible();
  await expect(page.getByText("2 photos", { exact: true })).toBeVisible();
  await tile(page, 2).click();
  const large = page.getByRole("dialog", { name: "Photo 2" });
  await expect(large.locator("img")).toBeVisible();
  await expect
    .poll(() => large.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(large.getByText("Bordure arrachée")).toBeVisible();
  await page.keyboard.press("Escape");
  // No longer among the day's other photos: they are the report's.
  await expect(page.getByRole("region", { name: "Autres photos de la journée" })).toHaveCount(0);

  // The list counts them.
  await page.goto(`/projets/${project.id}/rapports`);
  await expect(page.getByRole("link", { name: /2 photos/ })).toBeVisible();

  // Taken out of the report: the photo stays in the project.
  await page.goto(`/projets/${project.id}/rapports/${reportId}/modifier`);
  await tile(page, 1, "Regard R-7").click();
  await answer(page, "Photo 1", "Retirer du rapport");
  await expect(tile(page, 1, "Bordure arrachée")).toBeVisible();
  await expect(tile(page, 2)).toHaveCount(0);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(new RegExp(`/rapports/${reportId}$`));
  expect((await reportNamed(foreman, reportId)).photoIds).toHaveLength(1);
  expect(await photosOf(foreman, project.id)).toHaveLength(2);
  await expect(page.getByRole("region", { name: "Autres photos de la journée" })).toBeVisible();

  await project.leave();
  await Promise.all([office.close(), foreman.close()]);
});

test("the day's photos are chosen several at once, and a clash leaves them in the project", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const project = await projectWith(office, foreman, "photos du jour");
  for (const caption of ["Livraison EXEMPLE", "Regard R-2", null])
    await addPhoto(foreman, project.id, caption);

  const page = await foreman.newPage();
  await page.goto(`/projets/${project.id}/rapports/nouveau`);
  await page.getByLabel("Travaux réalisés").fill("Réfection de la chaussée.");
  await page.getByRole("button", { name: /Photos du jour/ }).click();
  const chooser = page.getByRole("dialog", { name: "Photos du jour" });
  await expect(chooser.locator("button[aria-pressed=false]")).toHaveCount(3);
  await page.waitForTimeout(450);
  await chooser.getByRole("button", { name: "Livraison EXEMPLE" }).click();
  await chooser.getByRole("button", { name: "Regard R-2" }).click();
  await chooser.getByRole("button", { name: "Ajouter 2 photos" }).click();
  await expect(chooser).toHaveCount(0);
  await expect(tile(page, 1, "Livraison EXEMPLE")).toBeVisible();
  await expect(tile(page, 2, "Regard R-2")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\/rapports\/(?!nouveau)[a-z0-9]+$/);
  const reportId = page.url().split("/").at(-1) ?? "";
  const saved = await reportNamed(foreman, reportId);
  expect(saved.photoIds).toHaveLength(2);

  // The office saves in the meantime; the foreman adds the last one and saves.
  await page.goto(`/projets/${project.id}/rapports/${reportId}/modifier`);
  await expect(tile(page, 2)).toBeVisible();
  const theirs = await call(office.request, "PATCH", `/api/reports/${reportId}`, {
    notes: "Version du bureau.",
    baseUpdatedAt: saved.updatedAt,
  });
  expect(theirs.status).toBe(200);
  await page.getByRole("button", { name: /Photos du jour/ }).click();
  await page.waitForTimeout(450);
  await page
    .getByRole("dialog", { name: "Photos du jour" })
    .getByRole("button", { name: /Tout choisir/ })
    .click();
  await page
    .getByRole("dialog", { name: "Photos du jour" })
    .getByRole("button", { name: "Ajouter 1 photo" })
    .click();
  await expect(tile(page, 3)).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const clash = page.getByRole("dialog", { name: "Le rapport a changé" });
  await expect(clash).toContainText("2 photos");
  await expect(clash).toContainText("Votre photo ajoutée reste dans les photos du projet.");
  await answer(page, "Le rapport a changé", "Garder la version enregistrée");
  await expect(page).toHaveURL(new RegExp(`/rapports/${reportId}$`));
  expect((await reportNamed(foreman, reportId)).photoIds).toHaveLength(2);
  expect(await photosOf(foreman, project.id)).toHaveLength(3);

  await project.leave();
  await Promise.all([office.close(), foreman.close()]);
});

test("a photo taken without a network waits with the report, and the draft keeps it", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const project = await projectWith(office, foreman, "sans réseau");
  let page = await foreman.newPage();
  const address = `/projets/${project.id}/rapports/nouveau?jour=${siteDay()}`;
  await page.goto(address);
  await page.getByLabel("Travaux réalisés").fill("Pompage de la tranchée.");
  await expect(page.getByText("Pas encore enregistré.")).toBeVisible();

  await foreman.setOffline(true);
  await takePhoto(page);
  await expect(page.getByRole("dialog", { name: "Photo ajoutée" })).toContainText("Pas de réseau");
  await page
    .getByRole("dialog", { name: "Photo ajoutée" })
    .getByLabel("Description")
    .fill("Eau dans la tranchée");
  await answer(page, "Photo ajoutée", "Terminé");
  await expect(tile(page, 1)).toBeVisible();
  await expect(page.getByText("En attente", { exact: true })).toBeVisible();
  await expect(page.getByText("1 photo attend le réseau sur cet appareil.")).toBeVisible();
  // The form keeps its place and its draft names the photo.
  await expect(page).toHaveURL(new RegExp(`jour=${siteDay()}$`));
  const drafts = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("ead:rapport:"))
      .map(([, value]) => JSON.parse(value).form.photoIds as string[]),
  );
  expect(drafts).toEqual([[expect.any(String)]]);
  const [[photoId]] = drafts;
  // Its window says why it waits.
  await tile(page, 1).click();
  await expect(page.getByRole("dialog", { name: "Photo 1" })).toContainText("En attente du réseau");
  await page.keyboard.press("Escape");

  // The app closed, opened again with the network back: the photo goes, the draft still names it.
  await page.close();
  await foreman.setOffline(false);
  page = await foreman.newPage();
  await page.goto(address);
  await expect(page.getByText(/Brouillon écrit .*, repris\./)).toBeVisible();
  await expect(page.getByLabel("Travaux réalisés")).toHaveValue("Pompage de la tranchée.");
  await expect(tile(page, 1, "Eau dans la tranchée")).toBeVisible();
  await expect
    .poll(async () => (await photosOf(foreman, project.id)).map((p) => p.id))
    .toEqual([photoId]);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(/\/rapports\/(?!nouveau)[a-z0-9]+$/);
  const reportId = page.url().split("/").at(-1) ?? "";
  expect((await reportNamed(foreman, reportId)).photoIds).toEqual([photoId]);
  await expect(tile(page, 1, "Eau dans la tranchée")).toBeVisible();

  await project.leave();
  await Promise.all([office.close(), foreman.close()]);
});

test("the PDF is the saved report's main action: made, then opened, kept or shared", async ({
  browser,
}) => {
  const office = await contextAs(browser, "admin");
  const foreman = await contextAs(browser, "foreman");
  const project = await projectWith(office, foreman, "pdf");
  const photo = await addPhoto(foreman, project.id, "Bordure EXEMPLE");
  const { report } = await post<{ report: Report }>(
    foreman.request,
    `/api/projects/${project.id}/reports`,
    reportOf(siteDay(), [photo.id]),
  );
  const pdfPath = `/api/reports/${report.id}/pdf`;
  const page = await foreman.newPage();
  if (phone()) await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/projets/${project.id}/rapports/${report.id}`);
  await expect(page.getByText("Pose de bordures, rue EXEMPLE.")).toBeVisible();
  // Printing is done from the PDF now.
  await expect(page.getByRole("button", { name: "Imprimer" })).toHaveCount(0);

  if (!phone()) {
    // A computer opens it straight in a new tab, in the browser's own viewer.
    const link = page.getByRole("link", { name: "PDF" });
    await expect(link).toHaveAttribute("href", pdfPath);
    await expect(link).toHaveAttribute("target", "_blank");
    const answered = await call(foreman.request, "GET", pdfPath);
    expect(answered.status).toBe(200);
    expect(answered.headers["content-type"]).toBe("application/pdf");
  } else {
    // Beside "Modifier" in the bottom bar, both whole on a 360 px phone.
    const button = page.getByRole("button", { name: "PDF" });
    const edit = page.getByRole("link", { name: "Modifier" });
    for (const target of [button, edit]) {
      const box = (await target.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
    }
    const made = page.waitForResponse((response) => new URL(response.url()).pathname === pdfPath);
    await button.click();
    const sheet = page.getByRole("dialog", { name: "PDF du rapport" });
    await expect(sheet).toBeVisible();
    const response = await made;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    await expect(sheet.getByRole("link", { name: "Ouvrir" })).toHaveAttribute("href", pdfPath);
    await page.waitForTimeout(450);
    const download = page.waitForEvent("download");
    await sheet.getByRole("link", { name: "Télécharger" }).click();
    expect((await download).suggestedFilename()).toMatch(
      new RegExp(`^Rapport journalier [A-Za-z0-9-]+ ${siteDay()}\\.pdf$`),
    );
    await page.keyboard.press("Escape");

    // Without a network it says what it needs.
    await foreman.setOffline(true);
    await button.click();
    await expect(sheet).toContainText("il demande le réseau");
    await page.keyboard.press("Escape");
    await foreman.setOffline(false);
  }

  // An archived project: a foreman still gets the PDF, and nothing to change.
  await call(office.request, "PATCH", `/api/projects/${project.id}`, { status: "archive" });
  // (A device that has not just held the project open: it would show it as it was for a moment.)
  const device = await contextAs(browser, "foreman");
  const later = await device.newPage();
  await later.goto(`/projets/${project.id}/rapports/${report.id}`);
  await expect(later.getByText("Pose de bordures, rue EXEMPLE.")).toBeVisible();
  await expect(
    later.getByRole(phone() ? "button" : "link", { name: "PDF" }).filter({ visible: true }),
  ).toBeVisible();
  await expect(later.getByRole("link", { name: "Modifier" })).toHaveCount(0);
  expect((await call(foreman.request, "GET", pdfPath)).status).toBe(200);

  await project.leave();
  await Promise.all([office.close(), foreman.close(), device.close()]);
});
