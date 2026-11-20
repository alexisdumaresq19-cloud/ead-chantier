// The shell's plugins, each fetched the first time the app needs it. Only
// code that has checked isNativeApp() calls these: in a browser none of
// this is ever downloaded (importing @capacitor/core alone sets up a global).
//
// They hand back the module, never the plugin itself: a plugin is a proxy
// that answers every property, "then" included, so a promise resolved with
// it would call the native side for a method named "then".

export const appPlugin = () => import("@capacitor/app");
export const sharePlugin = () => import("@capacitor/share");
export const filesystemPlugin = () => import("@capacitor/filesystem");
export const fileViewerPlugin = () => import("@capacitor/file-viewer");
export const splashScreenPlugin = () => import("@capacitor/splash-screen");

/** What a plugin's refusal carries: a message, and a code for some. */
export type PluginError = { message?: string; code?: string };

export const pluginError = (error: unknown): PluginError =>
  typeof error === "object" && error !== null ? (error as PluginError) : {};
