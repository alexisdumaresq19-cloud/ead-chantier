/**
 * Fills an empty development database through the running app: an office
 * account, a foreman, a worker, three projects and, in the first one, a set
 * of example plans, two daily reports and the photos of the older one.
 * Everything is fictional.
 *
 *   npm run db:fresh && npm run dev        (in another terminal)
 *   BASE=http://localhost:3200 npm run seed
 *
 * It leaves in .data/dev/ (or SEED_OUT) a browser session per role (Playwright storage
 * states: admin.json, foreman.json, worker.json) and seed.json with the ids.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in a dev script */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3200";
const OUT = process.env.SEED_OUT ?? ".data/dev";
const PDF = `${OUT}/plans-exemple.pdf`;

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
    for (const c of response.headers.getSetCookie?.() ?? [])
      if (c.startsWith("ead_session=")) this.cookie = c.split(";")[0];
    const text = await response.text();
    if (!response.ok)
      throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as any;
  }
  /** What Playwright loads to be this person. */
  save(name: string) {
    const { hostname } = new URL(BASE);
    const state = {
      cookies: [
        {
          name: "ead_session",
          value: this.cookie.split("=")[1],
          domain: hostname,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    };
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(state, null, 2));
  }
}

mkdirSync(OUT, { recursive: true });
const admin = new Client();
const foreman = new Client();
const worker = new Client();

const { needed } = await admin.call("GET", "/api/setup");
if (!needed) {
  console.error("La base contient déjà des comptes. Videz-la d'abord : npm run db:fresh");
  process.exit(1);
}
await admin.call("POST", "/api/setup", {
  code: process.env.SETUP_CODE ?? "dev",
  name: "Camille Roy",
});

const main = await admin.call("POST", "/api/projects", {
  name: "Réfection de la rue Principale",
  number: "24-118",
  client: "Ville de Gaspé",
  address: "Rue Principale",
  city: "Gaspé",
  description: "Remplacement de l'aqueduc et de l'égout pluvial, puis pavage. Phase 2.",
});
const second = await admin.call("POST", "/api/projects", {
  name: "Stationnement du centre aquatique",
  number: "24-131",
  client: "Ville de Percé",
  city: "Percé",
});
const third = await admin.call("POST", "/api/projects", {
  name: "Remplacement du ponceau du ruisseau Blanc",
  number: "25-004",
  client: "MTMD",
  city: "Chandler",
});

const julie = await admin.call("POST", "/api/users", {
  name: "Julie Cyr",
  role: "contremaitre",
  title: "Contremaîtresse",
  phone: "418 555-0142",
  projectIds: [main.id, second.id],
});
await foreman.call("POST", `/api/invites/${julie.invite.url.split("/i/")[1]}`, {});
const qr = await foreman.call("POST", `/api/projects/${main.id}/qr`);
await worker.call("POST", `/api/invites/${qr.url.split("/j/")[1]}`, {
  name: "Marc Lévesque",
  phone: "418 555-0177",
});
await admin.call("POST", "/api/users", {
  name: "Simon Arsenault",
  role: "travailleur",
  title: "Opérateur",
  projectIds: [main.id],
});

// Marc came in by QR code: the office confirms him, as it would, so that his
// session lasts (an unconfirmed person is signed out after a week).
const people = await admin.call("GET", "/api/users");
const marc = people.find((person: any) => person.name === "Marc Lévesque");
await admin.call("PATCH", `/api/users/${marc.id}`, { unreviewed: false });

admin.save("admin");
foreman.save("foreman");
worker.save("worker");

// Two daily reports by the foreman, for the last two days; the older one with its photos.
const siteDay = (daysAgo: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    Date.now() - daysAgo * 86_400_000,
  );
const crew = [
  { name: "Julie Cyr", hours: 10, userId: null },
  { name: "Marc Lévesque", hours: 10, userId: null },
  { name: "Simon Arsenault", hours: 9.5, userId: null },
];

// A few photos of the oldest day, sent the way the foreman's phone sends them
// (announced, uploaded, then added), each drawn here and stamped "EXEMPLE".
const sharp = (await import("sharp")).default;
const samplePhotos = [
  { width: 1600, height: 1200, hour: 14, caption: "Tranchée ouverte entre R-3 et R-4 (exemple)" },
  {
    width: 1200,
    height: 1600,
    hour: 15,
    caption: "Conduite 200 mm en place sur son assise (exemple)",
  },
  { width: 1600, height: 1200, hour: 17, caption: null },
  { width: 1600, height: 1200, hour: 19, caption: "Remblai compacté, rue nettoyée (exemple)" },
];
const photoIds: string[] = [];
for (const [index, sample] of samplePhotos.entries()) {
  const { width: w, height: h } = sample;
  const picture = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="hsl(${200 + index * 6},50%,${72 - index * 4}%)"/>
    <rect y="${h * 0.56}" width="100%" height="${h * 0.44}" fill="hsl(${30 + index * 3},30%,${40 + index * 3}%)"/>
    <polygon points="${w * 0.12},${h * 0.62} ${w * 0.88},${h * 0.62} ${w * 0.72},${h * 0.94} ${w * 0.28},${h * 0.94}" fill="hsl(28,28%,24%)"/>
    <rect x="${w * 0.3}" y="${h * 0.76}" width="${w * 0.4}" height="${h * 0.06}" rx="${h * 0.03}" fill="#2f7fb4"/>
    <rect x="${w * 0.6}" y="${h * 0.3}" width="${w * 0.24}" height="${h * 0.2}" rx="10" fill="#e9a400"/>
    <text x="50%" y="${h * 0.16}" font-family="sans-serif" font-size="${Math.min(w, h) * 0.09}" font-weight="700" fill="#ffffff" text-anchor="middle">EXEMPLE ${index + 1}</text>
  </svg>`;
  const jpeg = await sharp(Buffer.from(picture)).jpeg({ quality: 82 }).toBuffer();
  const photoTicket = await foreman.call("POST", "/api/uploads", {
    projectId: main.id,
    kind: "photo",
    filename: `exemple-${index + 1}.jpg`,
    contentType: "image/jpeg",
    size: jpeg.length,
  });
  const photoSent = await fetch(new URL(photoTicket.target.url, BASE), {
    method: "PUT",
    headers: photoTicket.target.headers,
    body: jpeg,
  });
  if (!photoSent.ok) throw new Error(`Envoi de la photo refusé : ${photoSent.status}`);
  await foreman.call("POST", `/api/uploads/${photoTicket.uploadId}/complete`);
  const added = await foreman.call("POST", `/api/projects/${main.id}/photos`, {
    uploadId: photoTicket.uploadId,
    // In the site's afternoon of that day, whatever the season.
    takenAt: new Date(
      `${siteDay(2)}T${sample.hour}:${String(index * 13).padStart(2, "0")}:00Z`,
    ).toISOString(),
    ...(sample.caption ? { caption: sample.caption } : {}),
  });
  photoIds.push(added.id);
}

await foreman.call("POST", `/api/projects/${main.id}/reports`, {
  day: siteDay(2),
  weather: { condition: "nuageux", temperatureC: 6, note: "" },
  crew,
  equipment: "Pelle 320, rouleau compacteur, camion 10 roues",
  workDone:
    "Excavation de la tranchée entre les regards R-3 et R-4. Pose de 36 m de conduite d'aqueduc 200 mm.",
  notes: "",
  photoIds,
});
await foreman.call("POST", `/api/projects/${main.id}/reports`, {
  day: siteDay(1),
  weather: { condition: "pluie", temperatureC: 3, note: "Pluie forte en après-midi" },
  crew: crew.slice(0, 2),
  equipment: "Pelle 320, pompe 3 po",
  workDone:
    "Remblayage et compaction de la tranchée posée la veille. Essai de pression en préparation.",
  notes: "Arrêt à 14 h 30 à cause de la pluie. Visite de l'ingénieur de la Ville en matinée.",
});

// One document, sent the way a foreman would.
const { PDFDocument, StandardFonts } = await import("pdf-lib");
const sample = await PDFDocument.create();
const sheet = sample.addPage([612, 792]);
const font = await sample.embedFont(StandardFonts.HelveticaBold);
sheet.drawText("EXEMPLE - DOCUMENT FICTIF", { x: 72, y: 700, size: 20, font });
sheet.drawText("Programme de prevention du chantier", { x: 72, y: 660, size: 14, font });
const documentBytes = Buffer.from(await sample.save());
const documentTicket = await foreman.call("POST", "/api/uploads", {
  projectId: main.id,
  kind: "document",
  filename: "Programme de prévention.pdf",
  contentType: "application/pdf",
  size: documentBytes.length,
});
const sent = await fetch(new URL(documentTicket.target.url, BASE), {
  method: "PUT",
  headers: documentTicket.target.headers,
  body: documentBytes,
});
if (!sent.ok) throw new Error(`Envoi du document refusé : ${sent.status}`);
await foreman.call("POST", `/api/uploads/${documentTicket.uploadId}/complete`);
await foreman.call("POST", `/api/projects/${main.id}/documents`, {
  uploadId: documentTicket.uploadId,
  title: "Programme de prévention (exemple)",
  category: "sst",
});

// The example plans, imported the way the office would.
if (!existsSync(PDF))
  execFileSync("npx", ["tsx", "scripts/make-sample-plans.ts", PDF], { stdio: "inherit" });
const pdf = readFileSync(PDF);
const ticket = await foreman.call("POST", "/api/uploads", {
  projectId: main.id,
  kind: "plan",
  filename: "Plans civils — émis pour construction.pdf",
  contentType: "application/pdf",
  size: pdf.length,
});
const put = await fetch(new URL(ticket.target.url, BASE), {
  method: "PUT",
  headers: ticket.target.headers,
  body: pdf,
});
if (!put.ok) throw new Error(`Envoi du PDF refusé : ${put.status}`);
await foreman.call("POST", `/api/uploads/${ticket.uploadId}/complete`);
const started = await foreman.call("POST", `/api/projects/${main.id}/plan-imports`, {
  uploadId: ticket.uploadId,
  revisionLabel: "0",
  issuedOn: "2026-10-01",
});
let current: any;
for (const t0 = Date.now(); ;) {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  current = await foreman.call("GET", `/api/plan-imports/${started.id}`);
  const ready = current.pages?.filter((page: any) => page.status === "ready").length ?? 0;
  process.stdout.write(`\rConversion des plans : ${ready}/${current.pageCount ?? "?"} `);
  if (current.status !== "reading" && current.status !== "processing") break;
  if (Date.now() - t0 > 240_000) throw new Error("La conversion des plans prend trop de temps.");
}
console.log();
if (current.status !== "review")
  throw new Error(`Import en échec : ${current.error ?? current.status}`);
const published = await foreman.call("POST", `/api/plan-imports/${started.id}/publish`);

writeFileSync(
  `${OUT}/seed.json`,
  JSON.stringify(
    {
      base: BASE,
      projectId: main.id,
      otherProjectIds: [second.id, third.id],
      sheetIds: published.sheetIds,
      people: { admin: "Camille Roy", foreman: "Julie Cyr", worker: "Marc Lévesque" },
    },
    null,
    2,
  ),
);
console.log(
  `Prêt : 3 projets, ${published.sheetIds.length} feuilles de plans, 2 rapports, ${photoIds.length} photos, 1 document, 3 sessions dans ${OUT}/`,
);
