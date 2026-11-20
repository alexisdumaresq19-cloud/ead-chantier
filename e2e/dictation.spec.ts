import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { call, contextAs, seed } from "./support";

// Dictating a daily report. The server runs with AI_FAKE=1 (scripts/e2e.sh):
// whatever is recorded, it "hears" the same sentence and reads it with fixed
// rules, so these tests check the screens and the API, not the AI service.

/** A day with no report, far from the seeded ones and from the other tests'. */
function freeDay(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(date);
}

const newReport = (day: string) => `/projets/${seed.projectId}/rapports/nouveau?jour=${day}`;
const address = `/api/projects/${seed.projectId}/reports/dictation`;
const blank = (day: string) => ({
  day,
  weather: { condition: null, temperatureC: null, note: "" },
  crew: [],
  equipment: "",
  workDone: "",
  notes: "",
});

/** Opens the window from the report without recording: the tap starts one, which is cancelled. */
async function openWindow(page: Page) {
  await page.getByRole("button", { name: /Dicter le rapport|Continuer la dictée/ }).click();
  const dialog = page.getByRole("dialog", { name: /J'écoute|Dicter le rapport/ });
  await page.waitForTimeout(450);
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  return page.getByRole("dialog", { name: "Dicter le rapport" });
}

const captionOf = async (page: Page, id: string) =>
  (await call(page.context().request, "GET", `/api/photos/${id}`)).body.caption as string | null;

async function dictateOnce(page: Page) {
  // One tap opens the window and starts the recording.
  await page.getByRole("button", { name: /Dicter le rapport/ }).click();
  const stop = page.getByRole("button", { name: "Terminer l'enregistrement" });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1500);
  await stop.click();
  await expect(page.getByText("C'est noté")).toBeVisible({ timeout: 20_000 });
}

test("a foreman talks and the report fills itself", async ({ browser }) => {
  const context = await contextAs(browser, "foreman");
  const page = await context.newPage();
  await page.goto(newReport(freeDay(40)));
  await dictateOnce(page);

  // The answer reads back what was understood, value by value.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Soleil, −2 °C")).toBeVisible();
  await expect(dialog.getByText(`${seed.people.worker} · 10 h`)).toBeVisible();
  await expect(dialog.getByText("Travaux réalisés : ajouté")).toBeVisible();
  // The example has served: it does not come back.
  await expect(dialog.getByText("Par exemple")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Terminé" }).click();
  await expect(dialog).toBeHidden();

  // The form holds what was said, marked as dictated, and nothing is saved yet.
  await expect(page.getByRole("button", { name: "Soleil" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#report-temperature")).toHaveValue("-2");
  await expect(page.getByText(seed.people.worker, { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Travaux réalisés")).toHaveValue(/aqueduc/);
  await expect(page.getByText("Dicté").first()).toBeVisible();
  await expect(page.getByText(/Brouillon gardé/)).toBeVisible();
  // The big way in has become a row, so the filled parts show.
  await expect(page.getByRole("button", { name: /Dicter le rapport/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuer la dictée" })).toBeVisible();
  await context.close();
});

test("while recording the window says it listens, and says so when it hears nothing", async ({
  browser,
}) => {
  const context = await contextAs(browser, "foreman");
  // A microphone that gives only silence, as a covered or muted one would.
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () =>
      new AudioContext().createMediaStreamDestination().stream;
  });
  const page = await context.newPage();
  await page.goto(newReport(freeDay(44)));
  await page.getByRole("button", { name: /Dicter le rapport/ }).click();
  const dialog = page.getByRole("dialog", { name: "J'écoute…" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Annuler" })).toBeVisible();
  // "Terminé" keeps its place, hidden, until there is an answer.
  await expect(dialog.getByRole("button", { name: "Terminé" })).toBeHidden();
  await expect(dialog.getByText("Je n'entends rien. Approchez le téléphone.")).toBeVisible({
    timeout: 6000,
  });

  // The answers read aloud are a switch that says whether it is on.
  const aloud = dialog.getByRole("switch", { name: "Réponses à voix haute" });
  if (await aloud.count()) {
    const was = await aloud.getAttribute("aria-checked");
    await aloud.click();
    await expect(aloud).toHaveAttribute("aria-checked", was === "true" ? "false" : "true");
  }

  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("dialog", { name: "Dicter le rapport" })).toBeVisible();
  await expect(page.getByText("Je n'entends rien")).toHaveCount(0);
  await context.close();
});

test("a dictation can be put back, and typing works like talking", async ({ browser }) => {
  const context = await contextAs(browser, "foreman");
  const page = await context.newPage();
  await page.goto(newReport(freeDay(41)));
  await dictateOnce(page);

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Annuler cette dictée" }).click();
  await expect(dialog.getByText("C'est noté")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Écrire" }).click();
  await dialog.getByLabel("Votre texte").fill("Soleil. On a posé la conduite.");
  await dialog.getByRole("button", { name: "Envoyer" }).click();
  await expect(dialog.getByText("C'est noté")).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText("Soleil. On a posé la conduite.")).toBeVisible();
  await dialog.getByRole("button", { name: "Fermer" }).click();

  await expect(page.getByRole("button", { name: "Soleil" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The first dictation was put back: its temperature is gone.
  await expect(page.locator("#report-temperature")).toHaveValue("");
  await context.close();
});

test("the dictation adds to a report without losing what is written", async ({ browser }) => {
  const context = await contextAs(browser, "foreman");
  const day = freeDay(42);
  const current = { ...blank(day), workDone: "Excavation de la tranchée.", notes: "Visite." };
  const answer = await context.request.post(address, {
    headers: { origin: seed.base },
    multipart: { day, current: JSON.stringify(current), text: "Soleil. Remblayage." },
  });
  expect(answer.status()).toBe(200);
  const result = await answer.json();
  expect(result.heard).toBe("Soleil. Remblayage.");
  expect(result.content.workDone).toBe("Excavation de la tranchée.\nSoleil. Remblayage.");
  expect(result.content.notes).toBe("Visite.");
  expect(result.content.weather.condition).toBe("soleil");
  expect(result.changed).toEqual(["weather", "workDone"]);
  // Nothing was saved: the day still has no report.
  const saved = await call(
    context.request,
    "GET",
    `/api/projects/${seed.projectId}/reports/day/${day}`,
  );
  expect(saved.body.report).toBeNull();
  await context.close();
});

test("only those who write reports may dictate, and silence is said so", async ({ browser }) => {
  const day = freeDay(43);
  const form = { day, current: JSON.stringify(blank(day)), text: "Soleil." };

  const worker = await contextAs(browser, "worker");
  const refused = await worker.request.post(address, {
    headers: { origin: seed.base },
    multipart: form,
  });
  expect(refused.status()).toBe(403);
  await worker.close();

  const foreman = await contextAs(browser, "foreman");
  const silent = await foreman.request.post(address, {
    headers: { origin: seed.base },
    multipart: { ...form, text: "" },
  });
  expect(silent.status()).toBe(422);
  expect((await silent.json()).error.code).toBe("nothing_heard");

  const wrong = await foreman.request.post(address, {
    headers: { origin: seed.base },
    multipart: {
      ...form,
      audio: { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("bonjour") },
    },
  });
  expect(wrong.status()).toBe(400);
  await foreman.close();
});

test("a photo taken from the window goes with the report, and the assistant describes it", async ({
  browser,
}) => {
  const phone = test.info().project.name === "phone";
  const context = await contextAs(
    browser,
    "foreman",
    phone ? { viewport: { width: 360, height: 740 } } : {},
  );
  const page = await context.newPage();
  await page.goto(newReport(freeDay(45)));
  const dialog = await openWindow(page);

  // The camera, the strip and the footer's three places, all inside a narrow phone.
  const camera = dialog.getByLabel("Prendre une photo");
  await expect(dialog.getByText("Prenez vos photos ici")).toBeVisible();
  await expect(dialog.getByText(/les photos du rapport sont lues par un service/)).toBeVisible();
  const mic = await dialog.getByRole("button", { name: "Parler" }).boundingBox();
  const write = await dialog.getByRole("button", { name: "Écrire" }).boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(mic && write).toBeTruthy();
  if (phone && mic && write) {
    expect(Math.abs(mic.x + mic.width / 2 - width / 2)).toBeLessThan(2);
    expect(write.x).toBeGreaterThanOrEqual(0);
    expect(write.x + write.width).toBeLessThan(mic.x);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  const jpeg = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: "#8a7355" },
  })
    .jpeg()
    .toBuffer();
  await camera.setInputFiles({ name: "IMG_1.jpg", mimeType: "image/jpeg", buffer: jpeg });
  const added = page.getByRole("dialog", { name: "Photo ajoutée" });
  await expect(added).toBeVisible();
  await page.waitForTimeout(450);
  await added.getByRole("button", { name: "Terminé" }).click();
  // The photo's own window closed; the dictation stays, with the photo numbered in its strip.
  await expect(dialog).toBeVisible();
  const strip = dialog.getByRole("list", { name: "Photos du rapport" });
  await expect(strip.getByRole("figure", { name: /^Photo 1/ })).toBeVisible();

  // Once the project has it, the assistant can describe it.
  await dialog.getByRole("button", { name: "Décrire les photos" }).click({ timeout: 20_000 });
  await expect(dialog.getByText("C'est fait")).toBeVisible({ timeout: 20_000 });
  const described = dialog.getByRole("list", { name: "Photos décrites" });
  await expect(described).toContainText("Photo 1 : Vue du chantier (description d'exemple)");
  await expect(dialog.getByRole("button", { name: "Décrire les photos" })).toHaveCount(0);

  const photos = (await call(context.request, "GET", `/api/projects/${seed.projectId}/photos`))
    .body as { id: string; caption: string | null }[];
  const photo = photos.find((one) => one.caption === "Vue du chantier (description d'exemple)");
  expect(photo).toBeTruthy();
  const id = photo?.id ?? "";

  // Putting the turn back takes the description away.
  await dialog.getByRole("button", { name: "Annuler les descriptions" }).click();
  await expect.poll(() => captionOf(page, id)).toBeNull();
  await expect(dialog.getByRole("button", { name: "Décrire les photos" })).toBeVisible();

  await dialog.getByRole("button", { name: "Décrire les photos" }).click();
  await expect(dialog.getByText("C'est fait")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => captionOf(page, id)).toBe("Vue du chantier (description d'exemple)");
  await dialog.getByRole("button", { name: "Terminé" }).click();
  await expect(dialog).toBeHidden();

  // The saved report names the photo.
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page).toHaveURL(new RegExp(`/rapports/(?!nouveau)[a-z0-9]+$`));
  const reportId = page.url().split("/").at(-1) ?? "";
  const saved = (await call(context.request, "GET", `/api/reports/${reportId}`)).body;
  expect(saved.photoIds).toEqual([id]);
  await context.close();
});

test("the assistant puts the texts in clean French, and that can be put back", async ({
  browser,
}) => {
  const context = await contextAs(browser, "foreman");
  const page = await context.newPage();
  await page.goto(newReport(freeDay(46)));
  const work = page.getByLabel("Travaux réalisés");
  await work.fill("  on a posé  la conduite\nremblai de la tranchée");
  const dialog = await openWindow(page);

  await dialog.getByRole("button", { name: "Mettre au propre" }).click();
  await expect(dialog.getByText("C'est fait")).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText("Travaux réalisés : mis au propre")).toBeVisible();
  await expect(work).toHaveValue("On a posé la conduite.\nRemblai de la tranchée.");
  // A second clean copy would change nothing: it is not offered right after.
  await expect(dialog.getByRole("button", { name: "Mettre au propre" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Annuler la mise au propre" }).click();
  await expect(work).toHaveValue("  on a posé  la conduite\nremblai de la tranchée");
  await expect(dialog.getByRole("button", { name: "Mettre au propre" })).toBeVisible();
  await context.close();
});

test("the tasks need something to work on, and photo ids are only the project's", async ({
  browser,
}) => {
  const context = await contextAs(browser, "foreman");
  const day = freeDay(47);
  // An id the project does not hold is never looked at, whatever the screen says of it.
  const stranger = "abcdefghjkmnpqrs";
  const current = { ...blank(day), photoIds: [stranger] };
  const photos = [
    { id: stranger, caption: null, takenAt: new Date().toISOString(), onServer: true },
  ];
  const describe = await context.request.post(address, {
    headers: { origin: seed.base },
    multipart: {
      day,
      current: JSON.stringify(current),
      photos: JSON.stringify(photos),
      task: "describe",
    },
  });
  expect(describe.status()).toBe(422);
  expect((await describe.json()).error.code).toBe("nothing_to_describe");

  const tidy = await context.request.post(address, {
    headers: { origin: seed.base },
    multipart: { day, current: JSON.stringify(blank(day)), task: "tidy" },
  });
  expect(tidy.status()).toBe(422);
  expect((await tidy.json()).error.code).toBe("nothing_to_tidy");

  const unknown = await context.request.post(address, {
    headers: { origin: seed.base },
    multipart: { day, current: JSON.stringify(blank(day)), task: "ignore-tout" },
  });
  expect(unknown.status()).toBe(400);

  // A dictation tells which photos still on a phone could not be looked at.
  const said = await context.request.post(address, {
    headers: { origin: seed.base },
    multipart: {
      day,
      current: JSON.stringify(current),
      photos: JSON.stringify(photos),
      text: "Soleil.",
    },
  });
  expect(said.status()).toBe(200);
  const result = await said.json();
  expect(result.captions).toEqual([]);
  expect(result.unseen).toEqual([stranger]);
  expect(result.later).toEqual([]);
  await context.close();
});
