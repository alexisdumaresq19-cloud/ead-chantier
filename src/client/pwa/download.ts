// Downloading files into a cache, a few at a time, so that a lost connection
// or a full disk stops it cleanly and it can go on from where it was.

/** The network went away, or something else answered in its place: wait, then go on. */
export class NetworkLost extends Error {}
/** The file is not on the server: trying again will not help. */
export class FileMissing extends Error {}
/** The device has no room left. */
export class StorageFull extends Error {}

/** A file that takes longer than this is on a connection that is as good as gone. */
const FILE_TIMEOUT = 30_000;

/**
 * Runs `work` on every item, at most `parallel` at a time and in order.
 * The first failure stops the rest (the signal given to the others aborts)
 * and is thrown once they have let go.
 */
export async function pool<T>(
  items: readonly T[],
  parallel: number,
  work: (item: T, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const inner = new AbortController();
  const stop = () => inner.abort();
  signal.addEventListener("abort", stop);
  let next = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!inner.signal.aborted && next < items.length) {
      try {
        await work(items[next++], inner.signal);
      } catch (error) {
        failure ??= { error };
        stop();
      }
    }
  };
  try {
    if (signal.aborted) stop();
    await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
  } finally {
    signal.removeEventListener("abort", stop);
  }
  // Cancelled from outside: that is the reason, whatever the workers threw.
  signal.throwIfAborted();
  if (failure) throw failure.error;
}

/** Fetches one public file whole. Only an image counts as the file. */
async function download(url: string, signal: AbortSignal): Promise<Blob> {
  const limited = new AbortController();
  const stop = () => limited.abort();
  const timer = setTimeout(stop, FILE_TIMEOUT);
  signal.addEventListener("abort", stop);
  try {
    // "no-store" keeps the service worker out of it: it would file the
    // answer with what was merely seen.
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: limited.signal,
    });
    if (response.status === 404 || response.status === 410) throw new FileMissing(url);
    // An error, or a page where an image should be (a Wi-Fi's sign-in page).
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/"))
      throw new NetworkLost(url);
    return await response.blob();
  } catch (error) {
    if (signal.aborted || error instanceof FileMissing) throw error;
    throw new NetworkLost(url);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

type FileCache = Pick<Cache, "match" | "put" | "delete">;

/**
 * Puts one file in the `kept` cache and returns its size. A copy that was
 * already displayed moves over from `seen` without touching the network.
 */
export async function keepFile(
  url: string,
  { kept, seen }: { kept: FileCache; seen: FileCache },
  signal: AbortSignal,
): Promise<number> {
  const seenCopy = await seen.match(url);
  const file = seenCopy ? await seenCopy.blob() : await download(url, signal);
  try {
    await kept.put(
      url,
      new Response(file, { headers: { "content-type": file.type || "image/webp" } }),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError")
      throw new StorageFull();
    throw error;
  }
  // The copy that moved over, or one the worker filed in passing after all
  // (a browser with its cache switched off does not say "no-store").
  await seen.delete(url);
  return file.size;
}

/** The size of a file a cache already holds; 0 if it does not. */
export async function storedSize(cache: FileCache, url: string): Promise<number> {
  const response = await cache.match(url);
  return response ? (await response.blob()).size : 0;
}
