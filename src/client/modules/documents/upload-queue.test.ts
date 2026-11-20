import { describe, expect, it } from "vitest";

import { ApiFailure } from "../../lib/api";
import { createUploadQueue, sharedRefusal, summarize, type UploadItem } from "./upload-queue";

/** A queue whose sending and saving are settled by hand, one call at a time. */
function harness() {
  type Call = {
    filename: string;
    progress?: (fraction: number) => void;
    resolve: (value: string) => void;
    reject: (error: unknown) => void;
  };
  const sends: Call[] = [];
  const saves: Call[] = [];
  const added: string[] = [];
  const activity: boolean[] = [];

  const pending = (
    list: Call[],
    filename: string,
    signal: AbortSignal,
    progress?: Call["progress"],
  ) =>
    new Promise<string>((resolve, reject) => {
      list.push({ filename, progress, resolve, reject });
      signal.addEventListener("abort", () => reject(new DOMException("Annulé", "AbortError")));
    });

  const queue = createUploadQueue({
    send: (item, onProgress, signal) => pending(sends, item.filename, signal, onProgress),
    save: (item, _uploadId, signal) => pending(saves, item.filename, signal),
    onAdded: (projectId) => added.push(projectId),
    onActivity: (active) => activity.push(active),
  });
  const file = (name: string, size = 100) => ({
    file: new Blob([new Uint8Array(size)]),
    filename: name,
    title: name.replace(/\.pdf$/, ""),
  });
  const statuses = () =>
    Object.fromEntries(queue.getState().items.map((item) => [item.filename, item.status]));
  const idOf = (filename: string) =>
    queue.getState().items.find((item) => item.filename === filename)!.id;
  /** Lets the queue react to a settled promise. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  return { queue, sends, saves, added, activity, file, statuses, idOf, settle };
}

const offline = () => new ApiFailure(0, "offline", "Connexion perdue pendant l'envoi. Réessayez.");

describe("the queue of documents being sent", () => {
  it("sends one file at a time, in order, and creates each document once its file is in", async () => {
    const { queue, sends, saves, added, activity, file, statuses, settle } = harness();
    queue.add("p1", "permis", [file("a.pdf"), file("b.pdf")]);
    expect(statuses()).toEqual({ "a.pdf": "sending", "b.pdf": "waiting" });
    expect(sends).toHaveLength(1);

    sends[0].progress!(0.5);
    expect(queue.getState().items[0].progress).toBe(0.5);

    sends[0].resolve("upload-a");
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "saving", "b.pdf": "waiting" });
    expect(sends).toHaveLength(1);

    saves[0].resolve("");
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "done", "b.pdf": "sending" });
    expect(added).toEqual(["p1"]);

    sends[1].resolve("upload-b");
    await settle();
    saves[1].resolve("");
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "done", "b.pdf": "done" });
    expect(queue.getState().items.every((item) => item.category === "permis")).toBe(true);
    expect(activity).toEqual([true, false]);
  });

  it("carries on with the next file when one is refused, and retries only that one", async () => {
    const { queue, sends, saves, file, statuses, idOf, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf"), file("b.pdf")]);
    sends[0].reject(new ApiFailure(400, "bad_request", "Type de fichier non accepté."));
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "failed", "b.pdf": "sending" });
    expect(queue.getState().items[0].error).toBe("Type de fichier non accepté.");
    expect(queue.getState().stalled).toBe(false);

    sends[1].resolve("upload-b");
    await settle();
    saves[0].resolve("");
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "failed", "b.pdf": "done" });

    queue.retry(idOf("a.pdf"));
    expect(statuses()).toEqual({ "a.pdf": "sending", "b.pdf": "done" });
    expect(sends.map((call) => call.filename)).toEqual(["a.pdf", "b.pdf", "a.pdf"]);
  });

  it("does not send the file again when only creating the document failed", async () => {
    const { queue, sends, saves, file, statuses, idOf, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf")]);
    sends[0].resolve("upload-a");
    await settle();
    saves[0].reject(new ApiFailure(500, "server_error", "Une erreur est survenue. Réessayez."));
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "failed" });

    queue.retry(idOf("a.pdf"));
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "saving" });
    expect(sends).toHaveLength(1);
    expect(saves).toHaveLength(2);
  });

  it("stops when the network goes and starts again where it was when it comes back", async () => {
    const { queue, sends, file, statuses, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf"), file("b.pdf"), file("c.pdf")]);
    sends[0].reject(offline());
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "failed", "b.pdf": "waiting", "c.pdf": "waiting" });
    expect(queue.getState().stalled).toBe(true);
    expect(queue.getState().items[0].offline).toBe(true);
    expect(sends).toHaveLength(1);

    queue.resume();
    expect(queue.getState().stalled).toBe(false);
    expect(statuses()).toEqual({ "a.pdf": "sending", "b.pdf": "waiting", "c.pdf": "waiting" });
  });

  it("leaves a file refused for another reason alone when the network comes back", async () => {
    const { queue, sends, file, statuses, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf"), file("b.pdf")]);
    sends[0].reject(new ApiFailure(400, "bad_request", "Refusé."));
    await settle();
    sends[1].reject(offline());
    await settle();
    queue.resume();
    expect(statuses()).toEqual({ "a.pdf": "failed", "b.pdf": "sending" });
  });

  it("stops at a refusal for too many uploads, shows it as it is, and never retries by itself", async () => {
    const { queue, sends, file, statuses, idOf, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf"), file("b.pdf")]);
    queue.add("p2", "autre", [file("c.pdf")]);
    const message = "Trop d'envois n'ont pas abouti. Réessayez plus tard.";
    sends[0].reject(new ApiFailure(429, "too_many_uploads", message));
    await settle();
    // The allowance is the person's: nothing else is sent into the same refusal.
    expect(statuses()).toEqual({ "a.pdf": "failed", "b.pdf": "failed", "c.pdf": "failed" });
    expect(queue.getState().items.map((item) => item.error)).toEqual([message, message, message]);
    expect(queue.getState().items.some((item) => item.offline)).toBe(false);
    expect(sends).toHaveLength(1);

    // The network coming back is no reason to try again.
    queue.resume();
    await settle();
    expect(sends).toHaveLength(1);

    // The person may, one file at a time.
    queue.retry(idOf("b.pdf"));
    expect(statuses()).toMatchObject({ "a.pdf": "failed", "b.pdf": "sending" });
    expect(sends).toHaveLength(2);
  });

  it("stops the files of an archived project, and those only", async () => {
    const { queue, sends, saves, file, statuses, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf"), file("b.pdf")]);
    queue.add("p2", "autre", [file("c.pdf")]);
    sends[0].resolve("upload-a");
    await settle();
    saves[0].reject(new ApiFailure(403, "forbidden", "Ce projet est archivé."));
    await settle();
    expect(statuses()).toEqual({ "a.pdf": "failed", "b.pdf": "failed", "c.pdf": "sending" });
    expect(queue.getState().items[1].error).toBe("Ce projet est archivé.");
  });

  it("cancels the file on its way and moves on to the next", async () => {
    const { queue, sends, added, file, statuses, idOf, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf"), file("b.pdf")]);
    queue.remove(idOf("a.pdf"));
    await settle();
    expect(statuses()).toEqual({ "b.pdf": "sending" });
    expect(sends.map((call) => call.filename)).toEqual(["a.pdf", "b.pdf"]);
    expect(added).toEqual([]);
  });

  it("forgets what was sent for one project and keeps the rest", async () => {
    const { queue, sends, saves, file, statuses, settle } = harness();
    queue.add("p1", "autre", [file("a.pdf")]);
    queue.add("p2", "autre", [file("b.pdf")]);
    sends[0].resolve("upload-a");
    await settle();
    saves[0].resolve("");
    await settle();
    queue.clearDone("p2");
    expect(statuses()).toEqual({ "a.pdf": "done", "b.pdf": "sending" });
    queue.clearDone("p1");
    expect(statuses()).toEqual({ "b.pdf": "sending" });
  });

  it("tells screens of every change", () => {
    const { queue, file } = harness();
    let calls = 0;
    const stop = queue.subscribe(() => calls++);
    const before = queue.getState();
    queue.add("p1", "autre", [file("a.pdf")]);
    expect(calls).toBeGreaterThan(0);
    expect(queue.getState()).not.toBe(before);
    stop();
    const heard = calls;
    queue.remove(queue.getState().items[0].id);
    expect(calls).toBe(heard);
  });
});

describe("summarize", () => {
  const item = (status: UploadItem["status"], size: number, progress = 0): UploadItem => ({
    id: `${status}-${size}`,
    projectId: "p1",
    filename: "a.pdf",
    size,
    title: "a",
    category: "autre",
    status,
    progress,
    error: null,
    offline: false,
  });

  it("weighs progress by size", () => {
    const summary = summarize([
      item("done", 100, 1),
      item("sending", 300, 0.5),
      item("waiting", 100),
      item("failed", 500, 0.2),
    ]);
    expect(summary).toMatchObject({ count: 4, done: 1, failed: 1, active: 2 });
    expect(summary.progress).toBeCloseTo((100 + 150) / 1000);
  });

  it("is at zero for an empty list", () => {
    expect(summarize([])).toMatchObject({ count: 0, done: 0, failed: 0, active: 0, progress: 0 });
  });
});

describe("sharedRefusal", () => {
  const p1 = { projectId: "p1" };
  const p2 = { projectId: "p2" };

  it("holds every waiting file at the person's upload allowance", () => {
    for (const code of ["too_many_uploads", "daily_upload_limit"]) {
      const holds = sharedRefusal(new ApiFailure(429, code, "Trop."), "p1");
      expect(holds?.(p1)).toBe(true);
      expect(holds?.(p2)).toBe(true);
    }
  });

  it("holds the files of the same project when it refuses additions", () => {
    const holds = sharedRefusal(new ApiFailure(403, "forbidden", "Ce projet est archivé."), "p1");
    expect(holds?.(p1)).toBe(true);
    expect(holds?.(p2)).toBe(false);
  });

  it("leaves the others alone for a refusal about one file", () => {
    expect(sharedRefusal(new ApiFailure(403, "upload_failed", "Refusé."), "p1")).toBeNull();
    expect(sharedRefusal(new ApiFailure(400, "bad_request", "Refusé."), "p1")).toBeNull();
    expect(sharedRefusal(new ApiFailure(0, "offline", "Pas de réseau."), "p1")).toBeNull();
    expect(sharedRefusal(new Error("?"), "p1")).toBeNull();
  });
});
