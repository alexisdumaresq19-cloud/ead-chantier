import { navigate } from "../lib/location";
import { appPlugin } from "./plugins";

// Links that open the app. iOS gives the app the site's own addresses (the
// site publishes the list: Universal Links): a personal invitation /i/…, a
// site's code /j/…, account creation /inscription#code=…, or any screen
// someone sent. The shell then tells the page (appUrlOpen), and the page
// goes there itself, without leaving the app.

/** The sites whose addresses are this app's: its own, wherever it is served from. */
const HOSTS = new Set(["ead-chantier.vercel.app"]);

/**
 * The screen a link names ("/j/abc", "/inscription#code=…"), or null for
 * an address of another site, or one that is not a screen (the API, files).
 */
export function screenOf(link: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const own = new URL(origin);
  const ours = url.origin === own.origin || (url.protocol === "https:" && HOSTS.has(url.hostname));
  if (!ours) return null;
  if (/^\/(api|files|_next)(\/|$)/.test(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

const current = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Takes the person to a screen named by a link, as a tap inside the app would. */
export function goToLink(link: string) {
  const screen = screenOf(link, window.location.origin);
  if (!screen || screen === current()) return;
  if (new URL(screen, window.location.origin).pathname === window.location.pathname) {
    // The same screen with another code: it reads its address once, when it
    // opens, so it is opened afresh.
    window.location.replace(screen);
    if (screen.includes("#")) window.location.reload();
    return;
  }
  navigate(screen);
}

let started = false;

/** Listens for the links that open the app, and follows the one it was opened with. */
export async function followAppLinks() {
  if (started) return;
  started = true;
  const { App: app } = await appPlugin();
  // The shell keeps a link that arrived before anyone listened and hands it
  // to the first listener; asking for the launch address covers the rest.
  // At a cold start the same link comes both ways; later, a link tapped
  // again is followed again.
  let last = { url: "", at: 0 };
  const follow = (url: string | undefined) => {
    if (!url || (url === last.url && Date.now() - last.at < 3000)) return;
    last = { url, at: Date.now() };
    goToLink(url);
  };
  await app.addListener("appUrlOpen", (event) => follow(event.url));
  try {
    const launch = await app.getLaunchUrl();
    follow(launch?.url);
  } catch {
    // Opened from its icon.
  }
}
