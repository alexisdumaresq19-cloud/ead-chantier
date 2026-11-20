import { keepStorage } from "../pwa/storage";
import { clearCachedFiles } from "./files";
import { followAppLinks } from "./links";
import { fileViewerPlugin, sharePlugin, splashScreenPlugin } from "./plugins";

// What the page does once, when it opens inside the iPhone app.

/** Runs after the next frame is on screen. */
const afterPaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

/**
 * The shell's launch image goes as soon as the page has drawn something:
 * the page's own first frame looks the same (the logo on black), so the
 * hand-over cannot be seen.
 */
export async function hideLaunchScreen() {
  try {
    await afterPaint();
    const { SplashScreen } = await splashScreenPlugin();
    await SplashScreen.hide({ fadeOutDuration: 150 });
  } catch {
    // An older shell without the plugin hides it by itself.
  }
}

/** Long enough for the first screen to have what it needs first. */
const WARM_DELAY = 3000;

/**
 * Fetches the code of the share sheet and the file viewer while the network
 * is there, so that the offline worker keeps it: otherwise its first use is
 * a tap, and a tap without a network (saving a photo the server has not
 * taken yet) could not load it.
 */
export function warmPlugins(): Promise<unknown> {
  return Promise.allSettled([sharePlugin(), fileViewerPlugin()]);
}

let started = false;

export function startNativeApp() {
  if (started) return;
  started = true;
  void hideLaunchScreen();
  void followAppLinks().catch(() => {});
  // The app is installed by definition: its plans must not be cleared to make room.
  void keepStorage();
  void clearCachedFiles();
  setTimeout(() => void warmPlugins(), WARM_DELAY);
}
