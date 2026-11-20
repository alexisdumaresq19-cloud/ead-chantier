import { describe, expect, it, vi } from "vitest";

import { appStoreUrl } from "./app-store";

describe("the App Store link", () => {
  it("is Apple's own address, or nothing", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("IOS_APP_STORE_URL", "");
    expect(appStoreUrl("")).toBeNull();
    expect(appStoreUrl(undefined)).toBeNull();
    expect(appStoreUrl(" https://apps.apple.com/ca/app/ead/id1234567890 ")).toBe(
      "https://apps.apple.com/ca/app/ead/id1234567890",
    );
    expect(appStoreUrl("http://apps.apple.com/ca/app/ead/id1")).toBeNull();
    expect(appStoreUrl("https://apps.apple.com.exemple.ca/app")).toBeNull();
    expect(appStoreUrl("pas un lien")).toBeNull();
    quiet.mockRestore();
    vi.unstubAllEnvs();
  });
});
