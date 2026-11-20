import {
  appPlugin,
  fileViewerPlugin,
  filesystemPlugin,
  pluginError,
  sharePlugin,
  splashScreenPlugin,
} from "./plugins";

// For the diagnostic screen: each of the shell's plugins is asked something
// that changes nothing, to tell whether its native side answers.

export type PluginAnswer =
  | { name: string; state: "answers"; detail?: string }
  | { name: string; state: "missing" | "silent" | "failed"; detail?: string };

/** Long enough for a busy phone; a plugin that has not answered by then never will. */
const PATIENCE = 3000;

/** The code @capacitor/core gives a plugin the shell does not carry. */
const UNIMPLEMENTED = "UNIMPLEMENTED";

async function ask(
  name: string,
  question: () => Promise<string | undefined>,
  /** A refusal that proves the native side heard (a harmless wrong input). */
  heard?: (code: string | undefined) => boolean,
): Promise<PluginAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<PluginAnswer>((resolve) => {
    timer = setTimeout(() => resolve({ name, state: "silent" }), PATIENCE);
  });
  const answer = question().then(
    (detail): PluginAnswer => ({ name, state: "answers", detail }),
    (error): PluginAnswer => {
      const { code, message } = pluginError(error);
      if (code === UNIMPLEMENTED) return { name, state: "missing" };
      if (heard?.(code)) return { name, state: "answers", detail: code };
      return { name, state: "failed", detail: message ?? String(error) };
    },
  );
  try {
    return await Promise.race([answer, silence]);
  } finally {
    clearTimeout(timer);
  }
}

/** The app's own version, as the shell knows it (the App Store's build). */
export type ShellInfo = { version: string; build: string; id: string };

export async function shellInfo(): Promise<ShellInfo | null> {
  try {
    const { version, build, id } = await (await appPlugin()).App.getInfo();
    return { version, build, id };
  } catch {
    return null;
  }
}

export function askPlugins(): Promise<PluginAnswer[]> {
  return Promise.all([
    ask("App", async () => {
      const info = await (await appPlugin()).App.getInfo();
      return `${info.version} (${info.build})`;
    }),
    ask("Share", async () => {
      const { value } = await (await sharePlugin()).Share.canShare();
      return value ? "partage possible" : "partage impossible";
    }),
    ask("Filesystem", async () => {
      const { Filesystem } = await filesystemPlugin();
      const { publicStorage } = await Filesystem.checkPermissions();
      return publicStorage;
    }),
    ask(
      "FileViewer",
      // An empty path: the viewer refuses it at once, and opens nothing.
      async () => {
        await (await fileViewerPlugin()).FileViewer.openDocumentFromLocalPath({ path: "" });
        return undefined;
      },
      (code) => typeof code === "string" && code.startsWith("OS-PLUG-FLVW-"),
    ),
    ask("SplashScreen", async () => {
      await (await splashScreenPlugin()).SplashScreen.hide();
      return undefined;
    }),
  ]);
}
