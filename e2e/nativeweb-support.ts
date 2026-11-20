import { readFileSync } from "node:fs";

import type { BrowserContext, Page } from "@playwright/test";

// The iPhone app, as far as its pages can tell, in Chromium: the shell's
// real bridge script (node_modules/@capacitor/ios/…/native-bridge.js) put in
// every page before the page's own scripts, the way WKWebView user scripts
// are (JSExport.swift), over a fake native side. The fake side records each
// call and answers through window.Capacitor.fromNative, as the Swift side
// does (CapacitorBridge.swift, toJs / toJsError).

const BRIDGE = "node_modules/@capacitor/ios/Capacitor/Capacitor/assets/native-bridge.js";

/** The methods each plugin declares in Swift (pluginMethods). */
const PLUGINS: Record<string, string[]> = {
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

export const CACHES = "file:///var/mobile/Containers/Data/Application/APP/Library/Caches/";

export type NativeCall = {
  callbackId: string;
  pluginId: string;
  methodName: string;
  options: Record<string, unknown>;
};

/**
 * The native side, run in the page. Plain JavaScript in a string: a
 * function's own text would carry what a TypeScript compiler adds to it.
 */
const FAKE_NATIVE_SIDE = `(function (caches) {
  var calls = [];
  var answers = {};
  // What the native process keeps across page loads, as the shell does:
  // events waiting for a first listener (retainUntilConsumed) and the last
  // link received (ApplicationDelegateProxy.lastURL, never cleared).
  var PROCESS = "__native_process";
  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(PROCESS) || "null") || { retained: {}, lastURL: null };
    } catch (error) {
      return { retained: {}, lastURL: null };
    }
  }
  function save(state) {
    try {
      sessionStorage.setItem(PROCESS, JSON.stringify(state));
    } catch (error) {}
  }
  function deliver(call, data) {
    window.Capacitor.fromNative({
      callbackId: call.callbackId, pluginId: call.pluginId, methodName: "addListener",
      save: true, success: true, data: data,
    });
  }
  var defaults = {
    "App.getLaunchUrl": function () {
      var url = load().lastURL;
      return url ? { url: url } : {};
    },
    "Filesystem.writeFile": function (options) {
      return { uri: caches + String(options.path).split("/").map(encodeURIComponent).join("/") };
    },
    "Filesystem.checkPermissions": function () { return { publicStorage: "granted" }; },
    "App.getInfo": function () {
      return { name: "EAD", id: "ca.example.ead", build: "7", version: "1.0" };
    },
    "Share.canShare": function () { return { value: true }; },
  };
  function respond(call) {
    if (call.pluginId === "Console" || call.callbackId === "-1") return;
    if (call.methodName === "addListener") {
      // The first listener gets what waited for one (CAPPlugin.m addListener).
      var state = load();
      var key = call.pluginId + "." + call.options.eventName;
      var waiting = state.retained[key] || [];
      if (waiting.length === 0) return;
      delete state.retained[key];
      save(state);
      setTimeout(function () {
        waiting.forEach(function (data) { deliver(call, data); });
      }, 10);
      return;
    }
    if (call.methodName === "removeListener") return;
    var key = call.pluginId + "." + call.methodName;
    var answer = answers[key] || { data: defaults[key] ? defaults[key](call.options) : {} };
    setTimeout(function () {
      var result = { callbackId: call.callbackId, pluginId: call.pluginId, methodName: call.methodName };
      if (answer.error) {
        result.success = false;
        result.error = answer.error;
      } else {
        result.success = true;
        result.data = answer.data || {};
      }
      window.Capacitor.fromNative(result);
    }, 10);
  }
  window.webkit = {
    messageHandlers: {
      bridge: {
        postMessage: function (data) {
          calls.push(JSON.parse(JSON.stringify(data)));
          respond(data);
        },
      },
    },
  };
  window.__native = {
    calls: calls,
    answers: answers,
    emit: function (pluginId, eventName, data) {
      if (pluginId === "App" && eventName === "appUrlOpen") {
        var state = load();
        state.lastURL = data.url;
        save(state);
      }
      calls.forEach(function (call) {
        if (call.pluginId === pluginId && call.methodName === "addListener" &&
            call.options.eventName === eventName)
          deliver(call, data);
      });
    },
  };
})`;

/** Every script the shell puts at the start of each page, in its order. */
export function shellScript(plugins = Object.keys(PLUGINS)): string {
  const headers = plugins.map((name) => ({
    name,
    methods: [
      { name: "addListener" },
      { name: "removeListener" },
      { name: "removeAllListeners", rtype: "promise" },
      { name: "checkPermissions", rtype: "promise" },
      { name: "requestPermissions", rtype: "promise" },
      ...PLUGINS[name].map((method) => ({ name: method, rtype: "promise" })),
    ],
  }));
  return [
    `${FAKE_NATIVE_SIDE}(${JSON.stringify(CACHES)});`,
    // JSExport.exportCapacitorGlobalJS
    `window.Capacitor = { DEBUG: false, isLoggingEnabled: false, Plugins: {} }; window.WEBVIEW_SERVER_URL = 'capacitor://localhost'; window.CapacitorNativeConfig = { cookiesEnabled: false, httpEnabled: false };`,
    // JSExport.exportBridgeJS
    readFileSync(BRIDGE, "utf8"),
    // JSExport.exportJS, for each plugin: its header
    `(function (w) { var a = (w.Capacitor = w.Capacitor || {}); var h = (a.PluginHeaders = a.PluginHeaders || []); h.push(...${JSON.stringify(headers)}); })(window);`,
  ].join("\n;\n");
}

/** Every page of this context opens as inside the iPhone app. */
export const asNativeApp = (context: BrowserContext, plugins?: string[]) =>
  context.addInitScript({ content: shellScript(plugins) });

type NativeWindow = {
  __native: {
    calls: NativeCall[];
    answers: Record<string, unknown>;
    emit(pluginId: string, eventName: string, data: unknown): void;
  };
};

/** The calls the page made to the plugins, the console's left out. */
export const nativeCalls = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as NativeWindow).__native.calls.filter(
      (call) => call.pluginId !== "Console",
    ),
  );

/** The answer the native side gives a method from now on. */
export const answerNative = (
  page: Page,
  method: string,
  answer: { data?: unknown; error?: { message: string; code?: string } },
) =>
  page.evaluate(
    ([key, value]) => {
      (window as unknown as NativeWindow).__native.answers[key as string] = value;
    },
    [method, answer] as const,
  );

/** Sends an event to the page's listeners of a plugin (appUrlOpen…). */
export const emitNative = (page: Page, pluginId: string, eventName: string, data: unknown) =>
  page.evaluate(
    ([plugin, event, payload]) =>
      (window as unknown as NativeWindow).__native.emit(plugin as string, event as string, payload),
    [pluginId, eventName, data] as const,
  );

/**
 * The app is opened by a link (a cold start): the shell keeps the link for
 * the page's first listener and answers it to App.getLaunchUrl from then
 * on, for as long as the process lives, reloads included.
 */
export const openedByLink = (context: BrowserContext, url: string) =>
  context.addInitScript(
    ({ key, link }) => {
      try {
        if (sessionStorage.getItem(key) === null)
          sessionStorage.setItem(
            key,
            JSON.stringify({ retained: { "App.appUrlOpen": [{ url: link }] }, lastURL: link }),
          );
      } catch {
        // A blank page before the first one: no storage of its own.
      }
    },
    { key: "__native_process", link: url },
  );
