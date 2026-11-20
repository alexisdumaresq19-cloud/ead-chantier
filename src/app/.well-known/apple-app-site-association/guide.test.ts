import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The guide for the Mac (docs/ios/MAC.md) is followed to the letter by an
// agent that cannot ask anyone: a step number, a screen's label or an order
// that drifted from the code sends it the wrong way.
const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const guide = read("docs/ios/MAC.md");
const steps = new Set([...guide.matchAll(/^### (\d+\.\d+) /gm)].map((m) => m[1]));
const scripts = readdirSync(new URL("../../../../scripts/", import.meta.url))
  .filter((name) => /^ios-.*\.sh$/.test(name))
  .map((name) => [`scripts/${name}`, read(`scripts/${name}`)] as const);

/** The text of one step of the guide, up to the next heading. */
function step(number: string): string {
  const start = guide.indexOf(`### ${number} `);
  const end = guide.indexOf("\n#", start + 1);
  return guide.slice(start, end);
}

describe("the guide for the Mac", () => {
  it("has the steps the scripts and the developer page point to", () => {
    const sources: (readonly [string, string])[] = [
      ...scripts,
      ["docs/ios/README.md", read("docs/ios/README.md")],
      ["docs/ios/MAC.md", guide],
    ];
    const pointers = sources.flatMap(([file, text]) =>
      [...text.matchAll(/(?:MAC\.md,? (?:étape |step )?|[ÉéEe]tapes? |step )(\d+\.\d+)/g)].map(
        (m) => [file, m[1]] as const,
      ),
    );
    expect(pointers.length).toBeGreaterThan(5);
    // A step is always "4.3": a bare "étape 2" names a section, not a step.
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/MAC\.md,? (?:étape|step) \d+(?!\.\d)/);
    }
    for (const [file, number] of pointers) expect(steps, `${file}: ${number}`).toContain(number);
  });

  it("sends the release script's signing hint to the device registration", () => {
    const release = read("scripts/ios-release.sh");
    const [, number, point] = /MAC\.md, étape (\d+\.\d+), point (\d+)/.exec(release)!;
    expect(step(number)).toMatch(new RegExp(`^${point}\\. \\*\\*Un iPhone enregistré`, "m"));
  });

  it("installs the modules before the doctor checks them", () => {
    expect(guide.indexOf("npm ci\n")).toBeGreaterThan(0);
    expect(guide.indexOf("npm ci\n")).toBeLessThan(guide.indexOf("scripts/ios-doctor.sh\n"));
  });

  it("names screens and addresses the site has", () => {
    const shell = read("src/client/shell/shell.tsx");
    const account = read("src/client/modules/admin/account.tsx");
    const routes = read("src/client/routes.tsx");
    const number = /^### (\d+\.\d+) Les essais sur un vrai iPhone/m.exec(guide)![1];
    const tests = step(number);
    for (const label of tests.matchAll(/onglet \*\*([^*]+)\*\*/g)) {
      expect(shell).toContain(`label: "${label[1]}"`);
    }
    for (const button of ["Se déconnecter", "Supprimer mon compte"]) {
      expect(tests).toContain(`**${button}**`);
      expect(account).toContain(button);
    }
    for (const link of tests.matchAll(/`https:\/\/ead-chantier\.vercel\.app(\/[a-z]+)`/g)) {
      if (link[1] === "/diagnostic") continue; // another part's public screen
      expect(routes).toContain(`path="${link[1]}"`);
    }
  });

  it("reads the diagnostic screen by the labels it shows", () => {
    // Step 4.5 decides appBoundDomains from a screenshot of /diagnostic: the
    // rows and values it quotes are the screen's own.
    const facts = read("src/client/modules/diagnostic/facts.ts");
    const reading = step("4.5");
    const quoted = [
      "Dans l'application iPhone",
      "Mode hors ligne",
      "Actif sur cette page",
      "Installé, en attente du prochain lancement",
      "Non disponible ici",
      "Modules de l'application",
      "ne répond pas",
    ];
    for (const label of quoted) {
      expect(facts, label).toContain(`"${label}"`);
      expect(reading, label).toContain(`«&nbsp;${label}&nbsp;»`);
    }
  });

  it("keeps screenshots where git ignores them and macOS asks nothing", () => {
    expect(guide).not.toContain("~/Desktop");
    expect(read(".gitignore")).toContain("/ios/App/build/");
    for (const shot of guide.matchAll(/scripts\/ios-sim\.sh \S+ (\S+\.png)/g)) {
      expect(shot[1]).toMatch(/^ios\/App\/build\//);
    }
  });

  it("gives the app record the same values as the App Store sheet", () => {
    const store = read("store/README.md");
    const section = store.slice(store.indexOf("## 1. "), store.indexOf("## 2. "));
    const values = [...section.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(5);
    const record = step("4.6");
    for (const value of values) expect(record).toContain(`   - ${value}\n`);
    const skus = [store, guide].flatMap((text) =>
      [...text.matchAll(/SKU&nbsp;: `([^`]+)`/g)].map((m) => m[1]),
    );
    expect(new Set(skus)).toEqual(new Set(["ead-ios"]));
  });

  it("gives Apple review notes that fit the field and that the owner's page can lift", () => {
    const review = read("store/review-notes.en.md");
    const section = review.slice(review.indexOf("## Notes\n"), review.indexOf("\n## Attachment"));
    // The owner's page copies from the first "EAD is" to the last "Thank you.":
    // the sentence that introduces the text must not quote either.
    const from = section.indexOf("EAD is");
    expect(section.slice(from - 2, from + "EAD is the ".length)).toBe("\n\nEAD is the ");
    const notes = section.slice(from, section.lastIndexOf("Thank you.") + "Thank you.".length);
    const bytes = Buffer.byteLength(notes);
    // Apple's limit is 4,000 bytes, line ends included as the field may keep them (CRLF).
    expect(bytes + notes.split("\n").length - 1).toBeLessThanOrEqual(4000);
    expect(section).toContain(`${bytes.toLocaleString("en-US")} bytes of the 4,000 bytes allowed`);
    // Every label the reviewer is told to tap is one the screens show.
    const screens = readdirSync(new URL("../../../client/", import.meta.url), { recursive: true })
      .map(String)
      .filter((name) => /\.tsx?$/.test(name) && !name.includes(".test."))
      .map((name) => read(`src/client/${name}`))
      .join("\n")
      .replace(/&apos;/g, "'");
    const said = /^Soleil, /; // what the reviewer reads aloud
    const labels = [...notes.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((l) => !said.test(l));
    expect(labels.length).toBeGreaterThan(15);
    for (const label of labels) expect(screens, label).toContain(label);
  });

  it("says how long the launch logo can stay, and the shell's pages hide it", () => {
    const config = read("capacitor.config.ts");
    const ms = Number(/launchShowDuration: (\d+),/.exec(config)![1]);
    expect(read("docs/ios/README.md")).toContain(`at most ${ms / 1000} seconds`);
    for (const page of ["ios-shell/index.html", "ios-shell/offline.html"]) {
      expect(read(page), page).toContain('nativePromise?.("SplashScreen", "hide"');
    }
  });
});
