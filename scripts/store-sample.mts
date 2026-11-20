/**
 * More sample content for the App Store screenshots, on top of what
 * scripts/seed-dev.mts leaves: real site photos (public domain, from
 * store/sample-photos, each marked "EXEMPLE") in place of the seed's drawn
 * ones and over the last days, the photos of the last two reports, three
 * earlier reports and the documents of a project under way. Everything is
 * fictional and says so. It goes through the API, as the foreman for what
 * the site adds and as the office for the contract papers, the way their
 * phones would.
 *
 *   BASE=http://localhost:3265 npm run seed
 *   BASE=http://localhost:3265 npx tsx scripts/store-sample.mts
 *
 * "--preview <folder>" only writes the marked photos there, to look at them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in a dev script */
import { mkdirSync, readFileSync } from "node:fs";

import sharp from "sharp";

import { siteTimeToDate } from "../src/shared/photos";

const BASE = process.env.BASE ?? "http://localhost:3265";
const SEED = process.env.SEED_OUT ?? ".data/dev";
const PHOTOS = "store/sample-photos";

// --- Days ---------------------------------------------------------------------

const siteDay = (daysAgo: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(
    Date.now() - daysAgo * 86_400_000,
  );
/** The weekdays before the three days the seed already wrote reports or photos for. */
const earlierWorkdays = (count: number) => {
  const days: string[] = [];
  for (let back = 3; days.length < count; back++) {
    const day = siteDay(back);
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(day);
  }
  return days;
};
/** A moment of a day, on the site's clock. */
const at = (day: string, hour: number, minute: number) =>
  siteTimeToDate(
    Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`),
  ).toISOString();

// --- Photos -----------------------------------------------------------------------
// Real photographs of other sites, in the public domain (store/sample-photos/
// SOURCES.md). Each gets a small "EXEMPLE" mark, as the sample plans have, so
// that nobody takes it for one of EAD's sites.

async function markedPhoto(file: string) {
  const image = sharp(`${PHOTOS}/${file}`);
  const { width = 1024, height = 683 } = await image.metadata();
  const size = Math.round(Math.min(width, height) * 0.034);
  const w = Math.round(size * 6.4);
  const h = Math.round(size * 1.7);
  const mark = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" rx="${h / 2}" fill="#000" fill-opacity="0.5"/>
      <text x="${w / 2}" y="${h / 2 + size * 0.36}" font-family="sans-serif" font-weight="700"
        font-size="${size}" letter-spacing="${size * 0.12}" fill="#fff" text-anchor="middle">EXEMPLE</text>
    </svg>`,
  );
  // Centred at the top: the gallery's square thumbnails keep the middle of the picture.
  return image
    .composite([{ input: mark, left: Math.round((width - w) / 2), top: Math.round(size * 0.9) }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

type SamplePhoto = {
  file: string;
  day: string;
  hour: number;
  minute: number;
  caption: string;
};

const today = siteDay(0);
const yesterday = siteDay(1);
const twoDaysAgo = siteDay(2);
const earlier = earlierWorkdays(3);
// Today's photos are taken before now, whatever the hour the script runs.
const hourNow = Number(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "numeric",
    hourCycle: "h23",
  }).format(new Date()),
);
const todayHours = [Math.max(0, Math.min(9, hourNow - 2)), Math.max(0, Math.min(11, hourNow - 1))];

/** The seed's report of two days ago: excavation between R-3 and R-4, 36 m of water main. */
const twoDaysAgoPhotos: SamplePhoto[] = [
  {
    file: "excavation-tranchee.jpg",
    day: twoDaysAgo,
    hour: 7,
    minute: 12,
    caption: "Excavation de la tranchée entre R-3 et R-4 (exemple)",
  },
  {
    file: "pierre-concassee.jpg",
    day: twoDaysAgo,
    hour: 9,
    minute: 40,
    caption: "Pierre concassée pour le lit de la conduite (exemple)",
  },
  {
    file: "conduites-pvc.jpg",
    day: twoDaysAgo,
    hour: 13,
    minute: 5,
    caption: "Conduite d'aqueduc 200 mm avant la pose (exemple)",
  },
];
/** The seed's report of yesterday: backfill and compaction, stopped by the rain at 14 h 30. */
const yesterdayPhotos: SamplePhoto[] = [
  {
    file: "nivelage-remblai.jpg",
    day: yesterday,
    hour: 8,
    minute: 24,
    caption: "Remblayage de la tranchée entre R-3 et R-4 (exemple)",
  },
  {
    file: "remblai-en-reserve.jpg",
    day: yesterday,
    hour: 10,
    minute: 2,
    caption: "Matériau de remblai en réserve (exemple)",
  },
  {
    file: "ponceau-beton.jpg",
    day: yesterday,
    hour: 11,
    minute: 37,
    caption: "Ponceau en béton au chaînage 0+260 (exemple)",
  },
  {
    file: "aire-de-travail.jpg",
    day: yesterday,
    hour: 13,
    minute: 50,
    caption: "Aire de travail et signalisation, vue d'en haut (exemple)",
  },
];
const otherPhotos: SamplePhoto[] = [
  {
    file: "planage-chaussee.jpg",
    day: today,
    hour: todayHours[0],
    minute: 5,
    caption: "Planage de la chaussée, rue Principale (exemple)",
  },
  {
    file: "enrobe-finisseuse.jpg",
    day: today,
    hour: todayHours[1],
    minute: 15,
    caption: "Enrobé dans la finisseuse (exemple)",
  },
  {
    file: "pavage-bordure.jpg",
    day: earlier[0],
    hour: 10,
    minute: 30,
    caption: "Couche de base le long de la bordure, entre R-2 et R-3 (exemple)",
  },
  {
    file: "equipe-finisseuse.jpg",
    day: earlier[0],
    hour: 14,
    minute: 50,
    caption: "Pavage entre R-2 et R-3 (exemple)",
  },
];
const allPhotos = [...twoDaysAgoPhotos, ...yesterdayPhotos, ...otherPhotos];

if (process.argv[2] === "--preview") {
  const folder = process.argv[3] ?? "/tmp/store-sample";
  mkdirSync(folder, { recursive: true });
  for (const sample of allPhotos)
    await sharp(await markedPhoto(sample.file)).toFile(`${folder}/${sample.file}`);
  console.log(`Photos marquées dans ${folder}`);
  process.exit(0);
}

// --- The API, as the foreman or as the office ----------------------------------------

const seed = JSON.parse(readFileSync(`${SEED}/seed.json`, "utf8"));
const projectId: string = seed.projectId;
const sessionOf = (who: "foreman" | "admin") =>
  JSON.parse(readFileSync(`${SEED}/${who}.json`, "utf8")).cookies[0].value as string;
const sessions = { foreman: sessionOf("foreman"), admin: sessionOf("admin") };
type Who = keyof typeof sessions;

async function call(who: Who, method: string, path: string, body?: unknown) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      cookie: `ead_session=${sessions[who]}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as any;
}

/** Announced, sent, confirmed: the way a phone sends a file. Returns the upload's id. */
async function upload(
  who: Who,
  kind: "photo" | "document",
  filename: string,
  type: string,
  bytes: Buffer,
) {
  const ticket = await call(who, "POST", "/api/uploads", {
    projectId,
    kind,
    filename,
    contentType: type,
    size: bytes.length,
  });
  const sent = await fetch(new URL(ticket.target.url, BASE), {
    method: "PUT",
    headers: ticket.target.headers,
    body: new Uint8Array(bytes),
  });
  if (!sent.ok) throw new Error(`Envoi refusé\u00a0: ${sent.status}`);
  await call(who, "POST", `/api/uploads/${ticket.uploadId}/complete`);
  return ticket.uploadId as string;
}

const project = await call("foreman", "GET", `/api/projects/${projectId}`);
if (project.photoCount !== 4) {
  console.error(
    "Ce script part du seed tel quel (4 photos). Repartez de zéro\u00a0: npm run db:fresh, puis le seed.",
  );
  process.exit(1);
}

async function addPhoto(sample: SamplePhoto, index: number): Promise<string> {
  const uploadId = await upload(
    "foreman",
    "photo",
    `IMG_${4810 + index}.jpg`,
    "image/jpeg",
    await markedPhoto(sample.file),
  );
  const added = await call("foreman", "POST", `/api/projects/${projectId}/photos`, {
    uploadId,
    takenAt: at(sample.day, sample.hour, sample.minute),
    caption: sample.caption,
  });
  return added.id;
}

// The seed draws its photos as flat coloured shapes, fine for the tests and
// poor on a store page: they give way to the real ones.
const seedPhotos = await call("foreman", "GET", `/api/projects/${projectId}/photos`);
for (const photo of seedPhotos.photos ?? seedPhotos)
  await call("foreman", "DELETE", `/api/photos/${photo.id}`);

const added = new Map<SamplePhoto, string>();
for (const [index, sample] of allPhotos.entries()) added.set(sample, await addPhoto(sample, index));

// --- Reports ----------------------------------------------------------------------

// The seed's two reports get the photos of their day.
const reports = await call("foreman", "GET", `/api/projects/${projectId}/reports`);
for (const [day, photos] of [
  [twoDaysAgo, twoDaysAgoPhotos],
  [yesterday, yesterdayPhotos],
] as const) {
  const report = reports.find((one: any) => one.day === day);
  if (!report) continue;
  const full = await call("foreman", "GET", `/api/reports/${report.id}`);
  await call("foreman", "PATCH", `/api/reports/${report.id}`, {
    baseUpdatedAt: full.updatedAt,
    photoIds: photos.map((photo) => added.get(photo)),
  });
}

const crew = [
  { name: "Julie Cyr", hours: 10, userId: null },
  { name: "Marc Lévesque", hours: 10, userId: null },
  { name: "Simon Arsenault", hours: 9.5, userId: null },
];
const earlierReports = [
  {
    weather: { condition: "soleil", temperatureC: 4, note: "" },
    equipment: "Finisseuse, rouleau compacteur, deux camions 10 roues",
    workDone: "Pavage de la couche de base entre les regards R-2 et R-3, sur 85 m.",
    notes: "Circulation en alternance toute la journée.",
    photoIds: otherPhotos.filter((photo) => photo.day === earlier[0]).map((p) => added.get(p)),
  },
  {
    weather: { condition: "nuageux", temperatureC: 2, note: "" },
    equipment: "Pelle 320, camion 10 roues",
    workDone: "Excavation et chargement des déblais entre R-3 et R-4. 14 voyages.",
    notes: "",
    photoIds: [],
  },
  {
    weather: { condition: "vent", temperatureC: 5, note: "Vent fort en matinée" },
    equipment: "Pelle 320, rouleau compacteur",
    workDone: "Début de l'excavation au chaînage 0+120. Installation de la signalisation.",
    notes: "Rencontre de chantier avec l'ingénieur de la Ville à 7 h.",
    photoIds: [],
  },
];
for (const [index, content] of earlierReports.entries())
  await call("foreman", "POST", `/api/projects/${projectId}/reports`, {
    day: earlier[index],
    crew,
    ...content,
  });

// --- Documents --------------------------------------------------------------------
// Of the weight real ones have: pages of text, and for some a photo or a
// drawing, so the list shows sizes a contractor would recognise. The papers of
// the contract come from the office, the rest from the site.

const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
const filler =
  "Texte d'exemple sans valeur contractuelle. Les quantités, les dates et les noms sont fictifs. ";
async function samplePdf(title: string, pages: number, photo?: string) {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const image = photo
    ? await pdf.embedJpg(await sharp(`${PHOTOS}/${photo}`).jpeg({ quality: 92 }).toBuffer())
    : null;
  for (let page = 0; page < pages; page++) {
    const sheet = pdf.addPage([612, 792]);
    sheet.drawText("EXEMPLE - DOCUMENT FICTIF", {
      x: 72,
      y: 730,
      size: 11,
      font: bold,
      color: rgb(0.7, 0.1, 0.1),
    });
    sheet.drawText(title.replace(/[—]/g, "-").replace(/[^\x20-\x7eÀ-ÿ]/g, ""), {
      x: 72,
      y: 708,
      size: 14,
      font: bold,
    });
    sheet.drawText(`Page ${page + 1} de ${pages}`, { x: 480, y: 40, size: 8, font: regular });
    let y = 680;
    if (image && page === 0) {
      const width = 468;
      const height = (image.height / image.width) * width;
      sheet.drawImage(image, { x: 72, y: y - height, width, height });
      y -= height + 24;
    }
    for (; y > 70; y -= 12) sheet.drawText(filler, { x: 72, y, size: 8, font: regular });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

// The seed's one document, a page of a few words, is sent again with the others,
// as the office would have it.
const seedDocuments = await call("foreman", "GET", `/api/projects/${projectId}/documents`);
for (const document of seedDocuments)
  await call("foreman", "DELETE", `/api/documents/${document.id}`);

const documents: {
  who: Who;
  title: string;
  file: string;
  category: string;
  pages: number;
  photo?: string;
}[] = [
  {
    who: "admin",
    title: "Devis technique — section 02 (exemple)",
    file: "Devis section 02.pdf",
    category: "contrat",
    pages: 120,
    photo: "aire-de-travail.jpg",
  },
  {
    who: "admin",
    title: "Bordereau des quantités (exemple)",
    file: "Bordereau.pdf",
    category: "contrat",
    pages: 30,
  },
  {
    who: "admin",
    title: "Permis d'intervention de la Ville (exemple)",
    file: "Permis intervention.pdf",
    category: "permis",
    pages: 3,
    photo: "aire-de-travail.jpg",
  },
  {
    who: "admin",
    title: "Programme de prévention (exemple)",
    file: "Programme de prévention.pdf",
    category: "sst",
    pages: 40,
    photo: "equipe-finisseuse.jpg",
  },
  {
    who: "foreman",
    title: "Plan de signalisation (exemple)",
    file: "Plan de signalisation.pdf",
    category: "permis",
    pages: 4,
    photo: "planage-chaussee.jpg",
  },
  {
    who: "foreman",
    title: "Fiche technique — conduite PVC DR18 (exemple)",
    file: "Fiche conduite PVC.pdf",
    category: "fiches",
    pages: 6,
    photo: "conduites-pvc.jpg",
  },
  {
    who: "admin",
    title: "Échéancier des travaux (exemple)",
    file: "Echeancier.csv",
    category: "echeancier",
    pages: 0,
  },
  {
    who: "foreman",
    title: "Essais de compaction, semaine 46 (exemple)",
    file: "Essais compaction S46.pdf",
    category: "essais",
    pages: 8,
    photo: "nivelage-remblai.jpg",
  },
];
for (const doc of documents) {
  const csv = doc.file.endsWith(".csv");
  const bytes = csv
    ? Buffer.from(
        "Tâche;Début;Fin\nEXEMPLE - DOCUMENT FICTIF;;\n" +
          [
            "Signalisation et mobilisation;2026-10-26;2026-10-30",
            "Excavation R-1 à R-3;2026-11-02;2026-11-13",
            "Excavation R-3 à R-5;2026-11-09;2026-11-20",
            "Conduite d'aqueduc 200 mm;2026-11-09;2026-11-24",
            "Égout sanitaire 250 mm;2026-11-12;2026-11-26",
            "Remblayage et compaction;2026-11-13;2026-11-27",
            "Pavage couche de base;2026-11-16;2026-11-27",
          ]
            .map((line) => `${line}\n`)
            .join(""),
      )
    : await samplePdf(doc.title, doc.pages, doc.photo);
  const uploadId = await upload(
    doc.who,
    "document",
    doc.file,
    csv ? "text/csv" : "application/pdf",
    bytes,
  );
  await call(doc.who, "POST", `/api/projects/${projectId}/documents`, {
    uploadId,
    title: doc.title,
    category: doc.category,
  });
}

console.log(
  `Ajouté\u00a0: ${allPhotos.length} photos, ${earlierReports.length} rapports, ${documents.length} documents (exemples).`,
);
