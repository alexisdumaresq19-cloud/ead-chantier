import { expect, test, type Page } from "@playwright/test";

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

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Météo")).toBeVisible();
  await expect(dialog.getByText(/Équipe · 1/)).toBeVisible();
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
