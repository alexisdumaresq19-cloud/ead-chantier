import { describe, expect, it } from "vitest";

import { isThisBuild, markShell, obsoleteAssets, shellAssets, shellHeaders } from "./shell";

const page = (...assets: string[]) =>
  `<!DOCTYPE html><html lang="fr-CA"><head><meta charSet="utf-8"/>${assets
    .map((asset) =>
      asset.endsWith(".css")
        ? `<link rel="stylesheet" href="${asset}" data-precedence="next"/>`
        : asset.endsWith(".woff2")
          ? `<link rel="preload" as="font" href="${asset}" crossorigin=""/>`
          : `<script src="${asset}" async=""></script>`,
    )
    .join(
      "",
    )}<link rel="manifest" href="/manifest.webmanifest"/><title>EAD Chantier</title></head>` +
  `<body><img src="/brand/ead-logo.png"/><script>self.__next_f.push([1,"static/chunks/lazy.js"])</script></body></html>`;

const v1 = page(
  "/_next/static/chunks/app-1.js",
  "/_next/static/chunks/react.js",
  "/_next/static/chunks/style-1.css",
);
const v2 = page(
  "/_next/static/chunks/app-2.js",
  "/_next/static/chunks/react.js",
  "/_next/static/chunks/style-1.css",
);

describe("the shell's files", () => {
  it("lists the hashed scripts, styles and fonts the page asks for", () => {
    expect(
      shellAssets(
        page(
          "/_next/static/chunks/a.js",
          "/_next/static/chunks/b.css",
          "/_next/static/media/f.woff2",
        ),
      ),
    ).toEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/chunks/b.css",
      "/_next/static/media/f.woff2",
    ]);
  });

  it("ignores what is not hashed code and counts a file once", () => {
    const html = page("/_next/static/chunks/a.js", "/_next/static/chunks/a.js");
    expect(shellAssets(html)).toEqual(["/_next/static/chunks/a.js"]);
  });

  it("reads addresses as the browser does", () => {
    const html = page("/_next/static/chunks/%5Broot%5D_a.js?dpl=1&amp;x=2");
    expect(shellAssets(html)).toEqual(["/_next/static/chunks/%5Broot%5D_a.js?dpl=1&x=2"]);
  });
});

describe("recognising this build's page", () => {
  const loaded = new Set([
    ...shellAssets(v1),
    "/_next/static/chunks/screen.js",
    "/brand/ead-logo.png",
  ]);

  it("accepts the page whose every file this page loaded", () => {
    expect(isThisBuild(v1, loaded)).toBe(true);
  });

  it("refuses the page of a newer build", () => {
    expect(isThisBuild(v2, loaded)).toBe(false);
  });

  it("refuses a page that is not the app's", () => {
    expect(isThisBuild("<html><head></head><body>Connexion au Wi-Fi</body></html>", loaded)).toBe(
      false,
    );
  });
});

describe("marking the stored shell", () => {
  it("writes the version in the head", () => {
    expect(markShell(v1, "3f9a01c2")).toContain(
      '<meta name="ead-shell" content="3f9a01c2"/></head>',
    );
  });

  it("refuses a version that could break out of the attribute, or a page without a head", () => {
    expect(markShell(v1, '"><script>')).toBeNull();
    expect(markShell("<p>erreur</p>", "3f9a01c2")).toBeNull();
  });

  it("leaves the page's own files untouched", () => {
    expect(shellAssets(markShell(v1, "3f9a01c2")!)).toEqual(shellAssets(v1));
  });
});

describe("files of the previous shell to drop", () => {
  it("drops what only the old page asked for", () => {
    const loaded = new Set(shellAssets(v2));
    expect(obsoleteAssets(v1, v2, loaded)).toEqual(["/_next/static/chunks/app-1.js"]);
  });

  it("keeps a file this page still loaded, even if the new page does not name it", () => {
    const loaded = new Set([...shellAssets(v2), "/_next/static/chunks/app-1.js"]);
    expect(obsoleteAssets(v1, v2, loaded)).toEqual([]);
  });

  it("drops nothing when the build is the same", () => {
    expect(obsoleteAssets(v1, v1, new Set(shellAssets(v1)))).toEqual([]);
  });
});

describe("the stored shell's headers", () => {
  it("keep the server's protections and font hints, not what described one transfer", () => {
    const stored = shellHeaders(
      new Headers({
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "frame-ancestors 'self'",
        "x-frame-options": "SAMEORIGIN",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
        link: "</_next/static/media/f.woff2>; rel=preload; as=font",
        "content-length": "8711",
        "content-encoding": "gzip",
        "cache-control": "s-maxage=31536000",
        etag: '"4ayrl9zej76pz"',
        vary: "rsc, Accept-Encoding",
        date: "Fri, 20 Nov 2026 00:34:11 GMT",
        "x-nextjs-cache": "HIT",
      }),
    );
    expect(Object.fromEntries(stored)).toEqual({
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "frame-ancestors 'self'",
      "x-frame-options": "SAMEORIGIN",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      link: "</_next/static/media/f.woff2>; rel=preload; as=font",
    });
  });

  it("say the page is HTML even when the server forgot to", () => {
    expect(shellHeaders(new Headers()).get("content-type")).toBe("text/html; charset=utf-8");
  });
});
