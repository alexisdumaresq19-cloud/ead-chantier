// The caches the service worker serves from (public/sw.js), for the parts the
// page fills itself: the shell and its code once they are known to be
// complete, and the projects kept on purpose. The names must match the
// worker's; worker.test.ts checks that they do.

/** The app's page. */
export const SHELL_CACHE = "ead-shell-v1";
/** Hashed code, fonts and brand images. */
export const STATIC_CACHE = "ead-static-v1";
/** Tiles, thumbnails and photos that were merely displayed. */
export const SEEN_CACHE = "ead-seen-v1";
/** Projects kept on purpose. */
export const KEPT_CACHE = "ead-kept-v1";

/** The address the shell is stored under, whatever screen was open. */
export const SHELL_URL = "/";

/** Cache storage exists only on HTTPS (and localhost), and not in every private window. */
export const canStore = () => typeof caches !== "undefined";

/** A file's address as a cache lists it: storage addresses are relative in development. */
export const absoluteUrl = (url: string) => new URL(url, window.location.origin).href;
