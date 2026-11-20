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

  it("says how long the launch logo can stay, and the shell's pages hide it", () => {
    const config = read("capacitor.config.ts");
    const ms = Number(/launchShowDuration: (\d+),/.exec(config)![1]);
    expect(read("docs/ios/README.md")).toContain(`at most ${ms / 1000} seconds`);
    for (const page of ["ios-shell/index.html", "ios-shell/offline.html"]) {
      expect(read(page), page).toContain('nativePromise?.("SplashScreen", "hide"');
    }
  });
});
