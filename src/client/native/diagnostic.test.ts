import { describe, expect, it } from "vitest";

import { installFakeBridge } from "./fake-bridge";

// The diagnostic's check of the plugins, in a shell that lacks one.

const bridge = installFakeBridge({ plugins: ["App", "Share", "Filesystem", "FileViewer"] });
const { askPlugins } = await import("./diagnostic");

describe("the plugins' check", () => {
  it("tells which plugins answer and which are missing", async () => {
    bridge.reset({
      "Filesystem.checkPermissions": () => ({ publicStorage: "granted" }),
      "FileViewer.openDocumentFromLocalPath": () => {
        throw {
          message: "Path of the file to open is either null or empty.",
          code: "OS-PLUG-FLVW-0006",
        };
      },
    });
    expect(await askPlugins()).toEqual([
      { name: "App", state: "answers", detail: "1.0 (7)" },
      { name: "Share", state: "answers", detail: "partage possible" },
      { name: "Filesystem", state: "answers", detail: "granted" },
      { name: "FileViewer", state: "answers", detail: "OS-PLUG-FLVW-0006" },
      { name: "SplashScreen", state: "missing" },
    ]);
    // Nothing was opened: the viewer was given an empty path.
    expect(bridge.calls().find((call) => call.pluginId === "FileViewer")?.options).toEqual({
      path: "",
    });
  });

  it("tells a plugin that fails from one that never answers", async () => {
    bridge.reset({
      "Share.canShare": () => {
        throw { message: "Erreur interne" };
      },
    });
    const answers = await askPlugins();
    expect(answers.find((answer) => answer.name === "Share")).toEqual({
      name: "Share",
      state: "failed",
      detail: "Erreur interne",
    });
  });
});
