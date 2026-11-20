// The iPhone app's own address on the App Store. The app is unlisted: no
// search finds it, and only this link installs it. Apple gives the link once
// it has made the app unlisted (store/README.md); it is then set on the host
// as IOS_APP_STORE_URL, read when asked, so that setting it needs no new
// build. Until then the screens send people to the office for it.

/** The link, or null while none is set (or what is set is not an App Store link). */
export function appStoreUrl(value = process.env.IOS_APP_STORE_URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && url.hostname === "apps.apple.com") return url.href;
  } catch {
    // Not an address at all: said below, like any other wrong value.
  }
  console.error("IOS_APP_STORE_URL is set but is not an https://apps.apple.com/… link");
  return null;
}
