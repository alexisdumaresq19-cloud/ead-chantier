// Copies the pages the iPhone app carries itself (index.html, offline.html)
// into ios-shell/dist, the folder capacitor.config.ts names as webDir, with
// the site's address and the logo written into them: the pages stand alone.
// No npm package: it runs before anything else on a new Mac.
//   node ios-shell/build.mjs        (scripts/ios-sync.sh runs it)
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const here = new URL("./", import.meta.url);
const root = new URL("../", import.meta.url);
const dist = new URL("dist/", here);
const PAGES = ["index.html", "offline.html"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

// One address for the whole app: the one capacitor.config.ts loads.
const config = await readFile(new URL("capacitor.config.ts", root), "utf8");
const site = /^const site = "(https:\/\/[a-z0-9.-]+)";$/m.exec(config)?.[1];
if (!site) {
  fail(
    'Adresse du site introuvable dans capacitor.config.ts (ligne const site = "https://…"). ' +
      "Remettez cette ligne, puis relancez.",
  );
}

const logo = await readFile(new URL("public/brand/ead-logo.png", root));
const logoUrl = `data:image/png;base64,${logo.toString("base64")}`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const page of PAGES) {
  const source = await readFile(new URL(page, here), "utf8");
  const html = source.replaceAll("__EAD_SITE__", site).replaceAll("__EAD_LOGO__", logoUrl);
  if (html.includes("__EAD_")) fail(`ios-shell/${page} garde un repère __EAD_… non remplacé.`);
  await writeFile(new URL(page, dist), html);
}
console.log(`Pages de l'app copiées dans ios-shell/dist (site ${site}).`);
