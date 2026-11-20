import { beforeEach, describe, expect, it, vi } from "vitest";

import { CACHES, installFakeBridge, settle, type Answer } from "./fake-bridge";

// The native module against the shell's real bridge script and the real
// @capacitor/core, over a fake native side that records each call.

const bridge = installFakeBridge();
const native = await import("./index");
const files = await import("./files");

/** A test's start: no call yet, and the native side's answers for it. */
async function page({ answers }: { answers?: Record<string, Answer> } = {}) {
  bridge.reset(answers);
  return { bridge, native, files };
}

const pdf = () =>
  new File([new TextEncoder().encode("%PDF-1.7 bonjour")], "Rapport journalier 24-118.pdf", {
    type: "application/pdf",
  });

beforeEach(() => {
  // Node has no share sheet of its own: the shell's is the one used.
  vi.stubGlobal("navigator", { userAgent: "test", onLine: true });
});

describe("in the iPhone app", () => {
  it("knows it is there", async () => {
    const { native } = await page();
    expect(native.isNativeApp()).toBe(true);
    expect(native.nativePlatform()).toBe("ios");
  });

  it("opens a file in the system's viewer from a copy in the cache", async () => {
    const { bridge, files } = await page();
    await files.openFile(pdf(), "Rapport journalier 24-118.pdf");
    const [write, open] = bridge.calls();
    expect(write).toMatchObject({ pluginId: "Filesystem", methodName: "writeFile" });
    expect(write.options).toMatchObject({ directory: "CACHE", recursive: true });
    expect(write.options.path).toMatch(/^ead-fichiers\/[\w-]+\/Rapport journalier 24-118\.pdf$/);
    expect(atob(write.options.data as string)).toBe("%PDF-1.7 bonjour");
    expect(open).toMatchObject({
      pluginId: "FileViewer",
      methodName: "openDocumentFromLocalPath",
    });
    expect(open.options.path).toMatch(
      new RegExp(`^${CACHES}ead-fichiers/[\\w-]+/Rapport%20journalier%2024-118\\.pdf$`),
    );
  });

  it("gives the viewer a plain path when it cannot find the file by its address", async () => {
    const { bridge, files } = await page({
      answers: {
        "FileViewer.openDocumentFromLocalPath": (options) => {
          if (String(options.path).startsWith("file://"))
            throw {
              message: "The file you are trying to open does not exist.",
              code: "OS-PLUG-FLVW-0004",
            };
          return {};
        },
      },
    });
    await files.openFile(pdf(), "a b.pdf");
    const opens = bridge.calls().filter((call) => call.pluginId === "FileViewer");
    expect(opens).toHaveLength(2);
    expect(opens[1].options.path).toMatch(
      /^\/var\/mobile\/Containers\/Data\/Application\/APP\/Library\/Caches\/ead-fichiers\/[\w-]+\/a b\.pdf$/,
    );
  });

  it("says so when the viewer refuses the file", async () => {
    const { files } = await page({
      answers: {
        "FileViewer.openDocumentFromLocalPath": () => {
          throw { message: "The file has no extension.", code: "OS-PLUG-FLVW-0013" };
        },
      },
    });
    await expect(files.openFile(pdf(), "sans extension")).rejects.toMatchObject({
      code: "OS-PLUG-FLVW-0013",
    });
  });

  it("lets the viewer fetch a signed link itself", async () => {
    const { bridge, files } = await page();
    await files.openFileAt("https://stockage.example/u/1/plan.pdf?token=t");
    expect(bridge.calls()).toEqual([
      expect.objectContaining({
        pluginId: "FileViewer",
        methodName: "openDocumentFromUrl",
        options: { url: "https://stockage.example/u/1/plan.pdf?token=t" },
      }),
    ]);
  });

  it("shares a file through the shell's share sheet when the web view cannot", async () => {
    const { bridge, files } = await page();
    expect(await files.shareFile(pdf(), { title: "Rapport" })).toBe("shared");
    const share = bridge.calls().find((call) => call.pluginId === "Share")!;
    expect(share.methodName).toBe("share");
    expect(share.options.title).toBe("Rapport");
    expect(share.options.files).toEqual([
      expect.stringMatching(new RegExp(`^${CACHES}ead-fichiers/.+\\.pdf$`)),
    ]);
  });

  it("shares through the web view's own sheet when it takes files", async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal("navigator", { share, canShare: () => true });
    const { bridge, files } = await page();
    const file = pdf();
    expect(await files.shareFile(file, { text: "Vu au chantier" })).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file], text: "Vu au chantier" });
    expect(bridge.calls()).toEqual([]);
  });

  it("takes a closed share sheet as an answer", async () => {
    const { files } = await page({
      answers: {
        "Share.share": () => {
          throw { message: "Share canceled" };
        },
      },
    });
    expect(await files.shareFile(pdf())).toBe("closed");
    expect(await files.shareLinkNatively({ url: "https://ead-chantier.vercel.app/j/x" })).toBe(
      "closed",
    );
  });

  it("hands a link to the share sheet", async () => {
    const { bridge, native } = await page();
    const data = {
      title: "Chantier",
      text: "Ouvrez ce lien.",
      url: "https://ead-chantier.vercel.app/j/abc",
    };
    expect(await native.shareLinkInApp(data)).toBe(true);
    expect(bridge.calls()).toEqual([
      expect.objectContaining({ pluginId: "Share", methodName: "share", options: data }),
    ]);
  });

  it("empties the files of an earlier launch", async () => {
    const { bridge, files } = await page({
      answers: {
        "Filesystem.rmdir": () => {
          throw { message: "Folder does not exist." };
        },
      },
    });
    await files.clearCachedFiles();
    expect(bridge.calls()).toEqual([
      expect.objectContaining({
        pluginId: "Filesystem",
        methodName: "rmdir",
        options: { path: "ead-fichiers", directory: "CACHE", recursive: true },
      }),
    ]);
  });

  it("hides the launch screen once a frame is drawn", async () => {
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => setTimeout(run, 0));
    const { bridge } = await page();
    const { hideLaunchScreen } = await import("./start");
    await hideLaunchScreen();
    expect(bridge.calls()).toEqual([
      expect.objectContaining({ pluginId: "SplashScreen", methodName: "hide" }),
    ]);
  });

  it("goes to the screen a link opens, and ignores other sites", async () => {
    const history: string[] = [];
    const location = new URL("https://ead-chantier.vercel.app/");
    vi.stubGlobal("location", location);
    vi.stubGlobal("history", {
      pushState: (_state: unknown, _title: string, to: string) => {
        history.push(to);
        const next = new URL(to, location);
        location.pathname = next.pathname;
        location.search = next.search;
        location.hash = next.hash;
      },
    });
    vi.stubGlobal("addEventListener", () => {});
    const { bridge } = await page({
      answers: { "App.getLaunchUrl": () => ({ url: "https://ead-chantier.vercel.app/i/premier" }) },
    });
    const { followAppLinks } = await import("./links");
    await followAppLinks();
    await settle();
    expect(history).toEqual(["/i/premier"]);

    bridge.emit("App", "appUrlOpen", { url: "https://ead-chantier.vercel.app/j/code-du-site" });
    bridge.emit("App", "appUrlOpen", { url: "https://exemple.com/j/autre" });
    await settle();
    expect(history).toEqual(["/i/premier", "/j/code-du-site"]);
  });
});
