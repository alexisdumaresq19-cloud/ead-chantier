import { PDFiumLibrary } from "@hyzyla/pdfium";
import { expect, test, type APIRequestContext } from "@playwright/test";

import { call, contextAs, post, seed } from "./support";

// A daily report's PDF, against the production build: the foreman gets the
// seeded report with its photos as a document named after the project and
// the day, holding the report's words and its photos' descriptions; the
// worker, a foreman outside the project and a signed-out visitor do not.

type Summary = { id: string; day: string; photoCount: number };

/** The seeded report that has photos: the older of the two. */
async function reportWithPhotos(request: APIRequestContext) {
  const list = await call<Summary[]>(request, "GET", `/api/projects/${seed.projectId}/reports`);
  const report = list.body.find((summary) => summary.photoCount > 0);
  expect(report, "the seed puts photos with a report").toBeTruthy();
  return report!;
}

/** The words of a PDF, every space made plain, page by page. */
async function textOf(pdf: Buffer): Promise<string[]> {
  const library = await PDFiumLibrary.init();
  try {
    const document = await library.loadDocument(pdf);
    const pages = [...document.pages()].map((page) => page.getText().replace(/\s+/g, " ").trim());
    document.destroy();
    return pages;
  } finally {
    library.destroy();
  }
}

test("the foreman gets the report as a PDF, with its words and its photos", async ({ browser }) => {
  const foreman = await contextAs(browser, "foreman");
  const report = await reportWithPhotos(foreman.request);
  const address = `/api/reports/${report.id}/pdf`;

  const started = Date.now();
  const response = await foreman.request.get(address);
  const elapsed = Date.now() - started;
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-disposition"]).toBe(
    `inline; filename="Rapport journalier 24-118 ${report.day}.pdf"`,
  );
  const pdf = await response.body();
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  // Four photos, redrawn for the page: light enough to send by email.
  expect(pdf.byteLength).toBeLessThan(1_500_000);
  expect(elapsed).toBeLessThan(5_000);

  const pages = await textOf(pdf);
  const text = pages.join(" ");
  for (const said of [
    "RAPPORT JOURNALIER",
    "PROJET 24-118",
    "Réfection de la rue Principale",
    "Ville de Gaspé",
    "Julie Cyr",
    "Contremaîtresse",
    "Nuageux, 6 °C",
    "Simon Arsenault",
    "Pelle 320, rouleau compacteur, camion 10 roues",
    "Excavation de la tranchée entre les regards R-3 et R-4.",
    "Aucune note",
    "PHOTOS",
    "Tranchée ouverte entre R-3 et R-4 (exemple)",
    "Conduite 200 mm en place sur son assise (exemple)",
    "Remblai compacté, rue nettoyée (exemple)",
  ])
    expect(text).toContain(said);
  // Each photo with its number and the hour it was taken on the site's clock; one has no description.
  expect(text).toContain("Tranchée ouverte entre R-3 et R-4 (exemple) · 9 h 00");
  expect(text).toContain("3 · 13 h 26");
  pages.forEach((page, index) => expect(page).toContain(`Page ${index + 1} de ${pages.length}`));

  // "?download" makes it a file to keep.
  const kept = await foreman.request.get(`${address}?download`);
  expect(kept.status()).toBe(200);
  expect(kept.headers()["content-disposition"]).toBe(
    `attachment; filename="Rapport journalier 24-118 ${report.day}.pdf"`,
  );
  await foreman.close();
});

test("the office gets it too; nobody else does", async ({ browser, playwright }) => {
  const office = await contextAs(browser, "admin");
  const report = await reportWithPhotos(office.request);
  const address = `/api/reports/${report.id}/pdf`;
  const fromOffice = await office.request.get(address);
  expect(fromOffice.status()).toBe(200);
  expect(fromOffice.headers()["content-type"]).toBe("application/pdf");

  // A worker of the project: reports are for foremen and the office.
  const worker = await contextAs(browser, "worker");
  const refused = await call(worker.request, "GET", address);
  expect(refused.status).toBe(403);
  expect(refused.headers["content-type"]).toContain("application/json");

  // A foreman outside the project: as if the report did not exist.
  const elsewhere = await post<{ id: string }>(office.request, "/api/projects", {
    name: `Essai PDF, ailleurs (${test.info().project.name})`,
  });
  const { report: hidden } = await post<{ report: { id: string } }>(
    office.request,
    `/api/projects/${elsewhere.id}/reports`,
    {
      day: report.day,
      weather: { condition: "soleil", temperatureC: 10, note: "" },
      crew: [],
      equipment: "",
      workDone: "Rapport d'un autre chantier (exemple).",
      notes: "",
    },
  );
  const foreman = await contextAs(browser, "foreman");
  expect((await call(foreman.request, "GET", `/api/reports/${hidden.id}/pdf`)).status).toBe(404);
  expect((await office.request.get(`/api/reports/${hidden.id}/pdf`)).status()).toBe(200);

  // A report that does not exist.
  expect((await call(foreman.request, "GET", "/api/reports/inconnu/pdf")).status).toBe(404);

  // Someone signed out.
  const visitor = await playwright.request.newContext({ baseURL: seed.base });
  const signedOut = await visitor.get(address);
  expect(signedOut.status()).toBe(401);
  expect(signedOut.headers()["content-type"]).not.toContain("pdf");

  await visitor.dispose();
  await Promise.all([office.close(), worker.close(), foreman.close()]);
});
