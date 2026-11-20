import { describe, expect, it } from "vitest";

import { keyCommand } from "./keys";

const press = (key: string, held: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) =>
  keyCommand({
    key,
    ctrlKey: Boolean(held.ctrl),
    metaKey: Boolean(held.meta),
    altKey: Boolean(held.alt),
  });

describe("the viewer's keyboard", () => {
  it("zooms with + and -, with or without Shift", () => {
    expect(press("+")).toBe("zoom-in");
    expect(press("=")).toBe("zoom-in");
    expect(press("-")).toBe("zoom-out");
    expect(press("0")).toBe("fit");
  });

  it("moves over the sheet with the arrows", () => {
    expect(press("ArrowLeft")).toBe("pan-left");
    expect(press("ArrowDown")).toBe("pan-down");
  });

  it("changes sheet with the page keys or the brackets", () => {
    expect(press("PageDown")).toBe("next");
    expect(press("]")).toBe("next");
    expect(press("PageUp")).toBe("previous");
    expect(press("[")).toBe("previous");
  });

  it("goes back with Escape and turns the sheet with R", () => {
    expect(press("Escape")).toBe("back");
    expect(press("r")).toBe("rotate");
    expect(press("R")).toBe("rotate");
  });

  it("leaves the browser's own shortcuts alone", () => {
    expect(press("+", { ctrl: true })).toBeNull();
    expect(press("0", { meta: true })).toBeNull();
    expect(press("ArrowLeft", { alt: true })).toBeNull();
    expect(press("r", { ctrl: true })).toBeNull();
  });

  it("takes brackets typed with AltGr, as on a Canadian French keyboard", () => {
    expect(press("[", { ctrl: true, alt: true })).toBe("previous");
    expect(press("]", { ctrl: true, alt: true })).toBe("next");
  });

  it("takes brackets typed with Option, as on a Mac's French keyboards", () => {
    expect(press("[", { alt: true })).toBe("previous");
    expect(press("]", { alt: true })).toBe("next");
    expect(press("]", { alt: true, meta: true })).toBeNull();
  });

  it("ignores every other key, including names objects have", () => {
    expect(press("a")).toBeNull();
    expect(press("Enter")).toBeNull();
    expect(press("constructor")).toBeNull();
  });
});
