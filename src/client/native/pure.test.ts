import { describe, expect, it } from "vitest";

import { cacheName, fileNameOf, plainPath, toBase64 } from "./files";
import { directionsUrl, isNativeApp } from "./index";
import { screenOf } from "./links";

// The parts of the native module that need no bridge.

describe("outside the app", () => {
  it("is never taken for the app", () => {
    expect(isNativeApp()).toBe(false);
  });

  it("sends directions to Google Maps in a browser, to Apple Maps in the app", () => {
    expect(directionsUrl("12 rue Principale, Gaspé", false)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=12%20rue%20Principale%2C%20Gasp%C3%A9",
    );
    expect(directionsUrl("12 rue Principale, Gaspé", true)).toBe(
      "https://maps.apple.com/?daddr=12%20rue%20Principale%2C%20Gasp%C3%A9",
    );
  });
});

describe("the screen a link opens", () => {
  const origin = "https://ead-chantier.vercel.app";

  it("keeps the whole address of the site's own links", () => {
    expect(screenOf(`${origin}/i/abc123`, origin)).toBe("/i/abc123");
    expect(screenOf(`${origin}/j/xyz`, origin)).toBe("/j/xyz");
    expect(screenOf(`${origin}/inscription#code=ABCD-1234`, origin)).toBe(
      "/inscription#code=ABCD-1234",
    );
    expect(screenOf(`${origin}/projets/p1/photos?jour=2026-11-20`, origin)).toBe(
      "/projets/p1/photos?jour=2026-11-20",
    );
  });

  it("takes the production address on another server of the app", () => {
    expect(screenOf(`${origin}/j/xyz`, "http://localhost:3262")).toBe("/j/xyz");
    expect(screenOf("http://localhost:3262/j/xyz", "http://localhost:3262")).toBe("/j/xyz");
  });

  it("ignores other sites, other schemes and what is not a screen", () => {
    expect(screenOf("https://exemple.com/j/xyz", origin)).toBeNull();
    expect(screenOf("https://ead-chantier.vercel.app.exemple.com/j/xyz", origin)).toBeNull();
    expect(screenOf("http://ead-chantier.vercel.app/j/xyz", "http://localhost:3262")).toBeNull();
    expect(screenOf("ead://j/xyz", origin)).toBeNull();
    expect(screenOf("pas une adresse", origin)).toBeNull();
    expect(screenOf(`${origin}/api/me`, origin)).toBeNull();
    expect(screenOf(`${origin}/files/private/u/1/a.pdf`, origin)).toBeNull();
  });
});

describe("files", () => {
  it("names a cached file as the person will read it", () => {
    expect(cacheName("Rapport journalier 24-118 2026-11-20.pdf")).toBe(
      "Rapport journalier 24-118 2026-11-20.pdf",
    );
    expect(cacheName("Plan 3/4: égout?.pdf")).toBe("Plan 3-4- égout-.pdf");
    expect(cacheName("..cache")).toBe("cache");
    expect(cacheName("   ")).toBe("fichier");
    const long = cacheName(`${"a".repeat(200)}.pdf`);
    expect(long).toHaveLength(120);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("turns a file address into a path", () => {
    expect(plainPath("file:///var/mobile/Caches/a%20b.pdf")).toBe("/var/mobile/Caches/a b.pdf");
    expect(plainPath("/var/x.pdf")).toBe("/var/x.pdf");
  });

  it("reads a file's name from the server's answer", () => {
    expect(fileNameOf('inline; filename="Rapport journalier 24-118 2026-11-20.pdf"')).toBe(
      "Rapport journalier 24-118 2026-11-20.pdf",
    );
    expect(fileNameOf("attachment; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf")).toBe("Résumé.pdf");
    expect(fileNameOf("inline")).toBeNull();
    expect(fileNameOf(null)).toBeNull();
  });

  it("carries any bytes, a large file included", async () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 256);
    const base64 = await toBase64(new Blob([bytes]));
    expect(Buffer.from(base64, "base64").equals(Buffer.from(bytes))).toBe(true);
  });
});
