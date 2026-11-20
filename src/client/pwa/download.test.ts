import { afterEach, describe, expect, it, vi } from "vitest";

import { FileMissing, keepFile, NetworkLost, pool, StorageFull, storedSize } from "./download";

const later = (ms = 1) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A cache, as far as a download uses one. */
function fakeCache(initial: Record<string, Blob> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    match: async (url: RequestInfo | URL) => {
      const file = files.get(String(url));
      return file ? new Response(file) : undefined;
    },
    put: async (url: RequestInfo | URL, response: Response) => {
      files.set(String(url), await response.blob());
    },
    delete: async (url: RequestInfo | URL) => files.delete(String(url)),
  };
}

const image = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: "image/webp" });
const answer = (body: Blob | string, status = 200, type = "image/webp") =>
  new Response(body, { status, headers: { "content-type": type } });

afterEach(() => vi.unstubAllGlobals());

describe("a few at a time", () => {
  it("does every item, never more than the limit at once, in order", async () => {
    let active = 0;
    let most = 0;
    const started: number[] = [];
    await pool(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (item) => {
        started.push(item);
        most = Math.max(most, ++active);
        await later();
        active--;
      },
      new AbortController().signal,
    );
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(most).toBe(3);
  });

  it("stops at the first failure and tells the others to let go", async () => {
    const started: number[] = [];
    const told: number[] = [];
    const failure = new NetworkLost();
    const run = pool(
      [1, 2, 3, 4, 5, 6],
      2,
      async (item, signal) => {
        started.push(item);
        signal.addEventListener("abort", () => told.push(item));
        await later(item === 2 ? 1 : 20);
        if (item === 2) throw failure;
      },
      new AbortController().signal,
    );
    await expect(run).rejects.toBe(failure);
    expect(started).toEqual([1, 2]);
    expect(told).toContain(1);
  });

  it("stops when cancelled, and says it was cancelled", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const run = pool(
      [1, 2, 3, 4],
      1,
      async (item) => {
        started.push(item);
        await later();
        if (item === 2) controller.abort();
      },
      controller.signal,
    );
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(started).toEqual([1, 2]);
  });

  it("does nothing once cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const work = vi.fn(async () => {});
    await expect(pool([1, 2], 2, work, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(work).not.toHaveBeenCalled();
  });
});

describe("keeping one file", () => {
  const url = "https://files.example/t/abc/11/0_0.webp";
  const signal = () => new AbortController().signal;

  it("downloads it into the kept cache and gives its size", async () => {
    const fetched = vi.fn(async () => answer(image(1200)));
    vi.stubGlobal("fetch", fetched);
    const kept = fakeCache();
    expect(await keepFile(url, { kept, seen: fakeCache() }, signal())).toBe(1200);
    expect(kept.files.get(url)?.size).toBe(1200);
    // Past the service worker and without cookies: a public file, stored by the page.
    expect(fetched).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ cache: "no-store", credentials: "omit", mode: "cors" }),
    );
  });

  it("leaves no second copy among what was seen", async () => {
    // The worker filed the answer as seen while the page was storing it.
    const seen = fakeCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        seen.files.set(url, image(1200));
        return answer(image(1200));
      }),
    );
    const kept = fakeCache();
    seen.match = async () => undefined;
    await keepFile(url, { kept, seen }, signal());
    expect(kept.files.has(url)).toBe(true);
    expect(seen.files.has(url)).toBe(false);
  });

  it("moves a copy that was already displayed, without the network", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const kept = fakeCache();
    const seen = fakeCache({ [url]: image(900) });
    expect(await keepFile(url, { kept, seen }, signal())).toBe(900);
    expect(fetched).not.toHaveBeenCalled();
    expect(kept.files.has(url)).toBe(true);
    expect(seen.files.has(url)).toBe(false);
  });

  it("takes a lost connection, a server error or a page in place of the image as the network gone", async () => {
    const kept = fakeCache();
    for (const outcome of [
      () => Promise.reject(new TypeError("Failed to fetch")),
      async () => answer("erreur", 503, "text/plain"),
      async () => answer("<html>Connexion au Wi-Fi</html>", 200, "text/html"),
    ]) {
      vi.stubGlobal("fetch", vi.fn(outcome));
      await expect(keepFile(url, { kept, seen: fakeCache() }, signal())).rejects.toBeInstanceOf(
        NetworkLost,
      );
    }
    expect(kept.files.size).toBe(0);
  });

  it("says when the file is not on the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer("", 404, "text/plain")),
    );
    await expect(
      keepFile(url, { kept: fakeCache(), seen: fakeCache() }, signal()),
    ).rejects.toBeInstanceOf(FileMissing);
  });

  it("says when the device is full", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(image(10))),
    );
    const kept = {
      ...fakeCache(),
      put: async () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    };
    await expect(keepFile(url, { kept, seen: fakeCache() }, signal())).rejects.toBeInstanceOf(
      StorageFull,
    );
  });

  it("lets a cancellation through as such", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    );
    await expect(
      keepFile(url, { kept: fakeCache(), seen: fakeCache() }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("weighing a stored file", () => {
  it("gives its size, or nothing if it is not there", async () => {
    const cache = fakeCache({ "/t/a.webp": image(321) });
    expect(await storedSize(cache, "/t/a.webp")).toBe(321);
    expect(await storedSize(cache, "/t/b.webp")).toBe(0);
  });
});
