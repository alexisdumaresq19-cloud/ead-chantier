import { canStore, SHELL_CACHE, SHELL_URL, STATIC_CACHE } from "./caches";

// The shell is the app's page: the same HTML for every address. The service
// worker serves a stored copy when the network is gone, so that copy must
// never be ahead of the code stored with it. The page therefore stores the
// shell itself, and only after proving two things: all of its own code is on
// the device, and the server still sends the page of this very build.

/** The stored shell carries the version it was stored for, in a <meta> of this name. */
const MARK = "ead-shell";

const path = (address: string) => {
  const url = new URL(address, "http://app");
  return url.pathname + url.search;
};

/** The hashed files a page asks for in its HTML: scripts, styles, preloaded fonts. */
export function shellAssets(html: string): string[] {
  const found = new Set<string>();
  for (const [, address] of html.matchAll(/\s(?:src|href)="(\/_next\/static\/[^"]+)"/g))
    found.add(path(address.replaceAll("&amp;", "&")));
  return [...found];
}

/**
 * Whether `html` is the page of the build running here: every file it asks
 * for was loaded by this page. A page that asks for none is not ours at all
 * (the sign-in page of a public Wi-Fi, an error page).
 */
export function isThisBuild(html: string, loaded: ReadonlySet<string>): boolean {
  const assets = shellAssets(html);
  return assets.length > 0 && assets.every((asset) => loaded.has(asset));
}

/** The HTML to store: the server's, plus the version it was stored for. */
export function markShell(html: string, version: string): string | null {
  if (!/^[\w.-]+$/.test(version) || !html.includes("</head>")) return null;
  return html.replace("</head>", `<meta name="${MARK}" content="${version}"/></head>`);
}

/** Headers about one transfer or about caching it: wrong for the stored copy. */
const NOT_KEPT =
  /^(content-length|content-encoding|transfer-encoding|connection|keep-alive|date|age|etag|last-modified|expires|cache-control|vary|set-cookie|x-nextjs-.*)$/;

/**
 * The headers the stored shell is served with: the server's own, so that the
 * page opened offline keeps the protections it has online (who may frame it,
 * no type sniffing, no referrer sent to other sites) and the fonts announced
 * in "link".
 */
export function shellHeaders(server: Headers): Headers {
  const headers = new Headers();
  server.forEach((value, name) => {
    if (!NOT_KEPT.test(name)) headers.set(name, value);
  });
  headers.set("content-type", "text/html; charset=utf-8");
  return headers;
}

/**
 * Files of the previous shell that nothing asks for any more. Only files the
 * old page loaded at every launch are listed, never a screen's own code: an
 * unchanged screen keeps its file from one build to the next.
 */
export function obsoleteAssets(
  previousHtml: string,
  html: string,
  loaded: ReadonlySet<string>,
): string[] {
  const current = new Set(shellAssets(html));
  return shellAssets(previousHtml).filter((asset) => !current.has(asset) && !loaded.has(asset));
}

/** The version of the stored shell, when this page was opened from it; null when the server sent it. */
export function openedFromShell(): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${MARK}"]`)?.content ?? null;
}

/** The code, fonts and brand images this page has loaded, as paths. */
export function loadedAssets(): Set<string> {
  const found = new Set<string>();
  const add = (address: string | null) => {
    if (!address) return;
    const url = new URL(address, window.location.origin);
    if (url.origin !== window.location.origin) return;
    if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/"))
      found.add(url.pathname + url.search);
  };
  for (const entry of performance.getEntriesByType("resource")) add(entry.name);
  for (const element of document.querySelectorAll("script[src], link[href]"))
    add(element.getAttribute("src") ?? element.getAttribute("href"));
  return found;
}

/**
 * Puts in the static cache what this page loaded before the worker could see
 * it (on the first visit, everything). The browser still has these files, so
 * nothing is downloaded twice.
 */
async function storeLoadedCode(loaded: ReadonlySet<string>) {
  const cache = await caches.open(STATIC_CACHE);
  const stored = new Set((await cache.keys()).map((request) => path(request.url)));
  await Promise.all(
    [...loaded]
      .filter((asset) => !stored.has(asset))
      .map(async (asset) => {
        const response = await fetch(asset);
        if (!response.ok) throw new Error(`${asset}: ${response.status}`);
        await cache.put(asset, response);
      }),
  );
}

/**
 * Stores this page as the shell for `version`, with its code. Call it once
 * every screen's code is loaded. Returns false, leaving the stored shell as
 * it was, when there is no network or when the server has moved on to a
 * newer build than the one running here.
 */
export async function storeShell(version: string): Promise<boolean> {
  if (!canStore()) return false;
  try {
    const loaded = loadedAssets();
    await storeLoadedCode(loaded);

    // "no-store": the server's page as it is now, not a copy the browser kept.
    const response = await fetch(SHELL_URL, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return false;
    const html = await response.text();
    const marked = isThisBuild(html, loaded) ? markShell(html, version) : null;
    if (!marked) return false;

    const cache = await caches.open(SHELL_CACHE);
    const previous = await cache.match(SHELL_URL);
    await cache.put(SHELL_URL, new Response(marked, { headers: shellHeaders(response.headers) }));

    if (previous) {
      const code = await caches.open(STATIC_CACHE);
      const obsolete = obsoleteAssets(await previous.text(), html, loaded);
      await Promise.all(obsolete.map((asset) => code.delete(asset)));
    }
    return true;
  } catch {
    return false;
  }
}
