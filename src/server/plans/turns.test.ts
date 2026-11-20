import { describe, expect, it } from "vitest";

import { pagesAtOnce, Turns } from "./turns";

describe("pagesAtOnce", () => {
  it("is 2 unless PLAN_PAGES_AT_ONCE says otherwise, and never under 1", () => {
    expect(pagesAtOnce(undefined)).toBe(2);
    expect(pagesAtOnce("")).toBe(2);
    expect(pagesAtOnce("beaucoup")).toBe(2);
    expect(pagesAtOnce("1")).toBe(1);
    expect(pagesAtOnce("4")).toBe(4);
    expect(pagesAtOnce("3.7")).toBe(3);
    expect(pagesAtOnce("0")).toBe(1);
    expect(pagesAtOnce("-5")).toBe(1);
  });
});

describe("Turns", () => {
  it("hands out no more than its limit, then serves those waiting in order", async () => {
    const turns = new Turns(2);
    const first = turns.tryTake()!;
    const second = turns.tryTake()!;
    expect(first && second).toBeTruthy();
    expect(turns.tryTake()).toBeNull();

    const served: string[] = [];
    const a = turns.take(60_000).then((turn) => (served.push("a"), turn));
    const b = turns.take(60_000).then((turn) => (served.push("b"), turn));
    first.release();
    first.release(); // a second release gives nothing more
    const turnA = await a;
    expect(served).toEqual(["a"]);
    // Released, the turn went to the one waiting: a newcomer gets none.
    expect(turns.tryTake()).toBeNull();
    second.release();
    await b;
    expect(served).toEqual(["a", "b"]);
    turnA!.release();
    expect(turns.tryTake()).not.toBeNull();
  });

  it("gives up waiting after the time given, and leaves the line", async () => {
    const turns = new Turns(1);
    const held = turns.tryTake()!;
    expect(await turns.take(20)).toBeNull();
    expect(await turns.take(0)).toBeNull();
    held.release();
    // Nobody is left in line: the turn is free for the next one.
    expect(turns.tryTake()).not.toBeNull();
  });
});
