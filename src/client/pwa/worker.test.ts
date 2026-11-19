import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KEPT_CACHE, SEEN_CACHE, SHELL_CACHE, SHELL_URL, STATIC_CACHE } from "./caches";

// The service worker (public/sw.js) is run here against a pretend browser:
// which requests it answers, from where, and what it stores.

const source = readFileSync("public/sw.js", "utf8");
const ORIGIN = "https://chantier.example";
const STORAGE = "https://abc.supabase.co/storage/v1/object/public/ead-public";

type Asked = { url: string; method?: string; mode?: string; cache?: string; range?: string };

function startWorker() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: string | { url: string }) =>
    new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const files = stores.get(name)!;
    return {
      match: async (request: string | { url: string }) => files.get(key(request))?.clone(),
      put: async (request: string | { url: string }, response: Response) => {
        // As the real one does: a file written again goes to the end.
        files.delete(key(request));
        files.set(key(request), response);
      },
      delete: async (request: string | { url: string }) => files.delete(key(request)),
      keys: async () => [...files.keys()].map((url) => ({ url })),
    };
  };
  const caches = {
    open: async (name: string) => open(name),
    match: async (request: string | { url: string }, options: { cacheName: string }) =>
      stores.get(options.cacheName)?.get(key(request))?.clone(),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const handlers: Record<string, (event: never) => void> = {};
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, handler: (event: never) => void) => (handlers[type] = handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  };
  const fetch = vi.fn<(request: { url: string }) => Promise<Response>>();
  new Function("self", "caches", "fetch", source)(self, caches, fetch);

  /** Sends a request through the worker. `answer` is undefined when it leaves it to the browser. */
  async function ask({ url, method = "GET", mode = "cors", cache = "default", range }: Asked) {
    let answer: Promise<Response> | undefined;
    const background: Promise<unknown>[] = [];
    handlers.fetch({
      request: {
        url: new URL(url, ORIGIN).href,
        method,
        mode,
        cache,
        headers: new Headers(range ? { range } : {}),
      },
      respondWith: (response: Promise<Response>) => (answer = Promise.resolve(response)),
      waitUntil: (work: Promise<unknown>) => background.push(work),
    } as never);
    const response = await answer;
    await Promise.all(background);
    return response;
  }

  const fill = (name: string, url: string, body = "stored") =>
    open(name).put(new URL(url, ORIGIN).href, new Response(body));
  const has = (name: string, url: string) =>
    stores.get(name)?.has(new URL(url, ORIGIN).href) ?? false;

  return { self, caches, stores, handlers, fetch, ask, fill, has };
}

const image = () => new Response("image", { headers: { "content-type": "image/webp" } });

let worker: ReturnType<typeof startWorker>;
beforeEach(() => {
  worker = startWorker();
});
afterEach(() => vi.useRealTimers());

describe("the worker's caches", () => {
  it("are the ones the page fills", () => {
    for (const name of [SHELL_CACHE, STATIC_CACHE, SEEN_CACHE, KEPT_CACHE])
      expect(source).toContain(`"${name}"`);
    expect(source).toContain(`caches.match("${SHELL_URL}", { cacheName: SHELL })`);
  });

  it("lose their old versions when a new worker takes over, and nothing else", async () => {
    await worker.fill("ead-shell-v0", "/");
    await worker.fill("ead-static-v0", "/_next/static/chunks/old.js");
    await worker.fill(KEPT_CACHE, "/files/public/t/abc/thumb.webp");
    await worker.fill("autre-chose", "/x");
    let done: Promise<void> | undefined;
    worker.handlers.activate({ waitUntil: (work: Promise<void>) => (done = work) } as never);
    await done;
    expect([...worker.stores.keys()].sort()).toEqual(["autre-chose", KEPT_CACHE]);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it("wait for the person before replacing a running worker", () => {
    expect(source).not.toMatch(/addEventListener\("install"/);
    worker.handlers.message({ data: { type: "activate" }, ports: [] } as never);
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
  });
});

describe("what goes straight to the network", () => {
  it("is everything under /api/, even when a copy sits in a cache", async () => {
    for (const name of [SHELL_CACHE, STATIC_CACHE, SEEN_CACHE, KEPT_CACHE])
      await worker.fill(name, "/api/projects");
    expect(await worker.ask({ url: "/api/projects" })).toBeUndefined();
    expect(await worker.ask({ url: "/api/version", mode: "navigate" })).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("is anything that is not a plain read", async () => {
    expect(
      await worker.ask({ url: "/files/public/t/abc/thumb.webp", method: "PUT" }),
    ).toBeUndefined();
    expect(
      await worker.ask({ url: "/files/public/t/abc/thumb.webp", range: "bytes=0-99" }),
    ).toBeUndefined();
  });

  it("is a file the page stores itself", async () => {
    expect(
      await worker.ask({ url: "/files/public/t/abc/thumb.webp", cache: "no-store" }),
    ).toBeUndefined();
  });

  it("is a private file, another site, or a file opened as a page", async () => {
    expect(await worker.ask({ url: "/files/private/d/devis.pdf?e=1&s=2" })).toBeUndefined();
    expect(
      await worker.ask({ url: "/files/private/d/devis.pdf?e=1&s=2", mode: "navigate" }),
    ).toBeUndefined();
    expect(await worker.ask({ url: "/manifest.webmanifest" })).toBeUndefined();
    expect(await worker.ask({ url: "https://www.google.com/maps/dir/" })).toBeUndefined();
    expect(
      await worker.ask({ url: "https://abc.supabase.co/storage/v1/object/sign/ead-private/x.pdf" }),
    ).toBeUndefined();
  });
});

describe("opening the app", () => {
  const launch = () => worker.ask({ url: "/projets/mkkt9u6ghg7jm26u", mode: "navigate" });

  it("takes the server's page when it answers", async () => {
    await worker.fill(SHELL_CACHE, "/", "stored shell");
    worker.fetch.mockResolvedValue(new Response("fresh page"));
    expect(await (await launch())!.text()).toBe("fresh page");
  });

  it("opens the stored shell at any address when the network is gone", async () => {
    await worker.fill(SHELL_CACHE, "/", "stored shell");
    worker.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await (await launch())!.text()).toBe("stored shell");
  });

  it("opens the stored shell when the server is in trouble", async () => {
    await worker.fill(SHELL_CACHE, "/", "stored shell");
    worker.fetch.mockResolvedValue(new Response("Bad gateway", { status: 502 }));
    expect(await (await launch())!.text()).toBe("stored shell");
  });

  it("does not wait long for a network that does not answer", async () => {
    vi.useFakeTimers();
    await worker.fill(SHELL_CACHE, "/", "stored shell");
    worker.fetch.mockReturnValue(new Promise(() => {}));
    const opened = launch();
    await vi.advanceTimersByTimeAsync(2900);
    let settled = false;
    void opened.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await (await opened)!.text()).toBe("stored shell");
  });

  it("waits for the server after « Mettre à jour », then gives up too", async () => {
    vi.useFakeTimers();
    await worker.fill(SHELL_CACHE, "/", "stored shell");
    const heard = vi.fn();
    worker.handlers.message({ data: { type: "update" }, ports: [{ postMessage: heard }] } as never);
    expect(heard).toHaveBeenCalled();

    let arrive: (response: Response) => void = () => {};
    worker.fetch.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    const opened = launch();
    await vi.advanceTimersByTimeAsync(10_000);
    arrive(new Response("new version"));
    expect(await (await opened)!.text()).toBe("new version");

    // Only that one reload is patient.
    worker.fetch.mockReturnValue(new Promise(() => {}));
    const next = launch();
    await vi.advanceTimersByTimeAsync(3100);
    expect(await (await next)!.text()).toBe("stored shell");
  });

  it("says so, with a way to retry, when the app was never stored", async () => {
    worker.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const response = (await launch())!;
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Réessayer");
  });

  it("passes a redirect on as the server sent it", async () => {
    await worker.fill(SHELL_CACHE, "/", "stored shell");
    const redirect = { status: 0, type: "opaqueredirect" } as Response;
    worker.fetch.mockResolvedValue(redirect);
    expect(await launch()).toBe(redirect);
  });
});

describe("code, fonts and brand images", () => {
  it("come from the cache without a request once stored", async () => {
    await worker.fill(STATIC_CACHE, "/_next/static/chunks/app.js", "stored code");
    expect(
      await (await worker.ask({ url: "/_next/static/chunks/app.js", mode: "no-cors" }))!.text(),
    ).toBe("stored code");
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("are stored the first time they are fetched", async () => {
    worker.fetch.mockResolvedValue(new Response("code"));
    expect(await (await worker.ask({ url: "/_next/static/media/font.woff2" }))!.text()).toBe(
      "code",
    );
    expect(worker.has(STATIC_CACHE, "/_next/static/media/font.woff2")).toBe(true);
  });

  it("are not stored when the server answers with an error", async () => {
    worker.fetch.mockResolvedValue(new Response("gone", { status: 404 }));
    await worker.ask({ url: "/_next/static/chunks/old.js" });
    expect(worker.has(STATIC_CACHE, "/_next/static/chunks/old.js")).toBe(false);
  });

  it("answer from the cache and refresh it, for images that are not hashed", async () => {
    await worker.fill(STATIC_CACHE, "/brand/ead-logo.png", "old logo");
    worker.fetch.mockResolvedValue(new Response("new logo"));
    expect(await (await worker.ask({ url: "/brand/ead-logo.png" }))!.text()).toBe("old logo");
    expect(await (await worker.ask({ url: "/brand/ead-logo.png" }))!.text()).toBe("new logo");
  });

  it("still answer from the cache when that refresh fails", async () => {
    await worker.fill(STATIC_CACHE, "/brand/ead-logo.png", "old logo");
    worker.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await (await worker.ask({ url: "/brand/ead-logo.png" }))!.text()).toBe("old logo");
  });
});

describe("tiles, thumbnails and photos", () => {
  const tile = `${STORAGE}/t/abc/11/0_0.webp`;

  it("come from a kept project first", async () => {
    await worker.fill(KEPT_CACHE, tile, "kept");
    await worker.fill(SEEN_CACHE, tile, "seen");
    expect(await (await worker.ask({ url: tile }))!.text()).toBe("kept");
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it("come from what was seen before, in development and in production", async () => {
    await worker.fill(SEEN_CACHE, tile, "seen");
    await worker.fill(SEEN_CACHE, "/files/public/t/abc/thumb.webp", "seen locally");
    expect(await (await worker.ask({ url: tile }))!.text()).toBe("seen");
    expect(await (await worker.ask({ url: "/files/public/t/abc/thumb.webp" }))!.text()).toBe(
      "seen locally",
    );
  });

  it("are stored as seen, never as kept, when the network gives them", async () => {
    worker.fetch.mockResolvedValue(image());
    expect(await (await worker.ask({ url: tile }))!.text()).toBe("image");
    expect(worker.has(SEEN_CACHE, tile)).toBe(true);
    expect(worker.has(KEPT_CACHE, tile)).toBe(false);
  });

  it("are not stored when the answer cannot be read (asked without CORS)", async () => {
    worker.fetch.mockResolvedValue({ status: 0, type: "opaque", clone: () => ({}) } as Response);
    await worker.ask({ url: tile, mode: "no-cors" });
    expect(worker.has(SEEN_CACHE, tile)).toBe(false);
  });

  it("fail as the network does when they are nowhere", async () => {
    worker.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(worker.ask({ url: tile })).rejects.toThrow("Failed to fetch");
  });

  it("push the oldest out once past the limit, and never touch a kept project", async () => {
    const limit = Number(/SEEN_LIMIT = (\d+)/.exec(source)![1]);
    for (let index = 0; index < limit; index++)
      await worker.fill(SEEN_CACHE, `${STORAGE}/t/old/${index}.webp`);
    for (let index = 0; index < limit + 10; index++)
      await worker.fill(KEPT_CACHE, `${STORAGE}/t/kept/${index}.webp`);
    worker.fetch.mockImplementation(async () => image());
    await worker.ask({ url: `${STORAGE}/t/new/0.webp` });
    await worker.ask({ url: `${STORAGE}/t/new/1.webp` });

    // The first write trims; later ones wait for the next round.
    expect(worker.stores.get(SEEN_CACHE)!.size).toBe(limit + 1);
    expect(worker.has(SEEN_CACHE, `${STORAGE}/t/old/0.webp`)).toBe(false);
    expect(worker.has(SEEN_CACHE, `${STORAGE}/t/old/1.webp`)).toBe(true);
    expect(worker.has(SEEN_CACHE, `${STORAGE}/t/new/1.webp`)).toBe(true);
    expect(worker.stores.get(KEPT_CACHE)!.size).toBe(limit + 10);
  });

  it("give room back when the device is full", async () => {
    const limit = Number(/SEEN_LIMIT = (\d+)/.exec(source)![1]);
    for (let index = 0; index < limit; index++)
      await worker.fill(SEEN_CACHE, `${STORAGE}/t/old/${index}.webp`);
    const seen = await worker.caches.open(SEEN_CACHE);
    worker.caches.open = async () => ({
      ...seen,
      put: async () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
    });
    worker.fetch.mockResolvedValue(image());
    expect(await (await worker.ask({ url: tile }))!.text()).toBe("image");
    expect(worker.stores.get(SEEN_CACHE)!.size).toBe(limit / 2);
  });
});
