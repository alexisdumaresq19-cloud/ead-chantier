import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInThisContext } from "node:vm";

// For the unit tests: the shell's real bridge script (the one the iPhone
// app injects in every page), run in Node, over a fake native side that
// records each call and answers through window.Capacitor.fromNative, the
// way the Swift side does (CapacitorBridge.swift, toJs / toJsError).

const BRIDGE = join(
  process.cwd(),
  "node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js",
);

/** The methods each plugin declares in Swift (pluginMethods), as the shell exports them. */
export const PLUGIN_METHODS: Record<string, string[]> = {
  App: [
    "exitApp",
    "getInfo",
    "getAppLanguage",
    "getLaunchUrl",
    "getState",
    "minimizeApp",
    "toggleBackButtonHandler",
  ],
  Share: ["canShare", "share"],
  Filesystem: [
    "readFile",
    "readFileInChunks",
    "writeFile",
    "appendFile",
    "deleteFile",
    "mkdir",
    "rmdir",
    "readdir",
    "getUri",
    "stat",
    "rename",
    "copy",
    "checkPermissions",
    "requestPermissions",
    "downloadFile",
  ],
  FileViewer: [
    "openDocumentFromLocalPath",
    "openDocumentFromResources",
    "openDocumentFromUrl",
    "previewMediaContentFromLocalPath",
    "previewMediaContentFromResources",
    "previewMediaContentFromUrl",
  ],
  SplashScreen: ["show", "hide"],
};

export type NativeCall = {
  callbackId: string;
  pluginId: string;
  methodName: string;
  options: Record<string, unknown>;
};

/** An answer: data to resolve with, or a thrown { message, code } to reject with. */
export type Answer = (options: Record<string, unknown>) => unknown;

export const CACHES = "file:///var/mobile/Containers/Data/Application/APP/Library/Caches/";

/** What the native side says when a test gives no answer of its own. */
const DEFAULTS: Record<string, Answer> = {
  "Filesystem.writeFile": (options) => ({
    uri: CACHES + String(options.path).split("/").map(encodeURIComponent).join("/"),
  }),
  "App.getInfo": () => ({ name: "EAD", id: "ca.example.ead", build: "7", version: "1.0" }),
  "App.getLaunchUrl": () => ({}),
  "Share.canShare": () => ({ value: true }),
};

type Global = Record<string, unknown> & {
  Capacitor?: {
    fromNative(result: unknown): void;
    PluginHeaders?: unknown[];
  };
};

/**
 * Installs the bridge on globalThis, once per test file: @capacitor/core and
 * the plugins register with the first bridge they meet, as in a page.
 * `plugins` lists the plugins the shell carries (all of them by default).
 * Returns the calls, as they arrive, the answers to give (changed by each
 * test), and a way to send an event to a listener.
 */
export function installFakeBridge({
  plugins = Object.keys(PLUGIN_METHODS),
}: { plugins?: string[] } = {}) {
  const g = globalThis as unknown as Global;
  const calls: NativeCall[] = [];
  const answers: Record<string, Answer> = {};
  const respond = (call: NativeCall) => {
    if (call.pluginId === "Console" || call.callbackId === "-1") return;
    if (call.methodName === "addListener" || call.methodName === "removeListener") return;
    const answer =
      answers[`${call.pluginId}.${call.methodName}`] ??
      DEFAULTS[`${call.pluginId}.${call.methodName}`] ??
      (() => ({}));
    setTimeout(() => {
      let result: Record<string, unknown>;
      try {
        result = { success: true, data: answer(call.options) ?? {} };
      } catch (error) {
        result = { success: false, error };
      }
      g.Capacitor!.fromNative({
        callbackId: call.callbackId,
        pluginId: call.pluginId,
        methodName: call.methodName,
        ...result,
      });
    }, 0);
  };

  g.window = g;
  // The bridge reads the cookie property's descriptor; nothing more of the DOM.
  class Document {}
  Object.defineProperty(Document.prototype, "cookie", { get: () => "", configurable: true });
  g.Document = Document;
  g.HTMLDocument = Document;
  // It keeps the page's own XHR aside, to patch it when the shell's HTTP is on (it is not).
  g.XMLHttpRequest ??= class XMLHttpRequest {};
  g.webkit = {
    messageHandlers: {
      bridge: {
        postMessage(data: NativeCall) {
          calls.push(data);
          respond(data);
        },
      },
    },
  };
  // What JSExport.swift puts first in every page.
  g.Capacitor = {
    DEBUG: false,
    isLoggingEnabled: false,
    Plugins: {},
  } as unknown as Global["Capacitor"];
  g.WEBVIEW_SERVER_URL = "capacitor://localhost";
  g.CapacitorNativeConfig = { cookiesEnabled: false, httpEnabled: false };
  runInThisContext(readFileSync(BRIDGE, "utf8"));
  g.Capacitor!.PluginHeaders = plugins.map((name) => ({
    name,
    methods: [
      { name: "addListener" },
      { name: "removeListener" },
      { name: "removeAllListeners", rtype: "promise" },
      { name: "checkPermissions", rtype: "promise" },
      { name: "requestPermissions", rtype: "promise" },
      ...PLUGIN_METHODS[name].map((method) => ({ name: method, rtype: "promise" })),
    ],
  }));

  /** Sends an event to the listeners of a plugin, as notifyListeners does. */
  function emit(pluginId: string, eventName: string, data: unknown) {
    for (const call of calls)
      if (
        call.pluginId === pluginId &&
        call.methodName === "addListener" &&
        call.options.eventName === eventName
      )
        g.Capacitor!.fromNative({
          callbackId: call.callbackId,
          pluginId,
          methodName: "addListener",
          save: true,
          success: true,
          data,
        });
  }

  /** The calls to plugins, without the console's. */
  const pluginCalls = () => calls.filter((call) => call.pluginId !== "Console");
  /** A new test: no call seen yet, the default answers. The listeners stay. */
  function reset(next: Record<string, Answer> = {}) {
    for (const call of calls.splice(0)) if (call.methodName === "addListener") calls.push(call);
    for (const key of Object.keys(answers)) delete answers[key];
    Object.assign(answers, next);
  }
  return {
    calls: () => pluginCalls().filter((call) => call.methodName !== "addListener"),
    emit,
    reset,
  };
}

/** Lets the bridge's answers (sent on a timer) arrive. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
