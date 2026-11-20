import { describe, expect, it } from "vitest";

import { asText, rows, type Facts } from "./facts";

const browser: Facts = {
  inApp: false,
  platform: "web",
  siteVersion: "0123456789abcdef",
  shell: null,
  worker: "controls",
  persisted: false,
  estimate: { usage: 5 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 },
  plugins: null,
  userAgent: "Mozilla/5.0 (iPhone)",
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
  online: true,
  cookies: true,
};

const value = (facts: Facts, label: string) => rows(facts).find((row) => row.label === label);

describe("the diagnostic", () => {
  it("says plainly what a browser is and has", () => {
    expect(value(browser, "Dans l'app iPhone")?.value).toBe("Non");
    expect(value(browser, "Plateforme")?.value).toBe("Navigateur");
    expect(value(browser, "Version de l'app")).toBeUndefined();
    expect(value(browser, "Modules de l'app")).toBeUndefined();
    expect(value(browser, "Mode hors ligne (service worker)")).toMatchObject({
      value: "Actif sur cette page",
      tone: "good",
    });
    expect(value(browser, "Espace utilisé")?.value).toBe("5\u00a0Mo sur 2\u00a0Go");
    expect(value(browser, "Marges de l'écran")?.value).toBe(
      "haut 59 · droite 0 · bas 34 · gauche 0 px",
    );
  });

  it("shows the app's own version and each plugin inside the app", () => {
    const app: Facts = {
      ...browser,
      inApp: true,
      platform: "ios",
      shell: { version: "1.0", build: "7", id: "x" },
      worker: "unsupported",
      plugins: [
        { name: "App", state: "answers", detail: "1.0 (7)" },
        { name: "SplashScreen", state: "silent" },
      ],
    };
    expect(value(app, "Dans l'app iPhone")).toMatchObject({ value: "Oui", tone: "good" });
    expect(value(app, "Plateforme")?.value).toBe("iOS");
    expect(value(app, "Version de l'app")?.value).toBe("1.0 (7)");
    expect(value(app, "Mode hors ligne (service worker)")).toMatchObject({
      value: "Non disponible ici",
      tone: "bad",
    });
    expect(value(app, "Modules de l'app")).toEqual({
      label: "Modules de l'app",
      value: "App\u00a0: répond (1.0 (7))\nSplashScreen\u00a0: ne répond pas",
      tone: "bad",
    });
  });

  it("puts a missing answer in red and reads as text for support", () => {
    const lost: Facts = { ...browser, siteVersion: null, online: false, cookies: false };
    expect(value(lost, "Version du site")).toMatchObject({
      value: "Pas de réponse du serveur",
      tone: "bad",
    });
    const text = asText(rows(lost));
    expect(text).toContain("Réseau\u00a0: Hors ligne");
    expect(text).toContain("Témoins (cookies)\u00a0: Désactivés");
    expect(text.split("\n")).toHaveLength(rows(lost).length);
  });
});
