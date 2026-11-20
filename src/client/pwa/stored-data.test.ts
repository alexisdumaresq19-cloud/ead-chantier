import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { keepUnusedData, LONGEST_TIMER } from "./stored-data";

const MONTH = 30 * 24 * 3600 * 1000;
const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a launch does: the data stored by the last one is put back, then screens read it. */
async function restoredAfterAMoment(prepare: (client: QueryClient) => void) {
  const before = new QueryClient();
  before.setQueryData(["projects"], [{ id: "p1" }]);
  const stored = dehydrate(before);

  const client = new QueryClient({ defaultOptions: { queries: { gcTime: MONTH } } });
  prepare(client);
  hydrate(client, stored);
  await later(20);
  return client.getQueryData(["projects"]);
}

describe("data kept for a month", () => {
  it("is dropped at once after a restore, a month being more than a timer can count", async () => {
    expect(await restoredAfterAMoment(() => {})).toBeUndefined();
  });

  it("stays once the delay is one a timer can count", async () => {
    expect(await restoredAfterAMoment(keepUnusedData)).toEqual([{ id: "p1" }]);
  });

  it("leaves a delay alone when a timer can count it, or when there is none", () => {
    for (const gcTime of [5 * 60_000, LONGEST_TIMER, Infinity]) {
      const client = new QueryClient({
        defaultOptions: { queries: { gcTime, staleTime: 20_000 } },
      });
      keepUnusedData(client);
      expect(client.getDefaultOptions().queries).toEqual({ gcTime, staleTime: 20_000 });
    }
  });

  it("keeps the other settings", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { gcTime: MONTH, staleTime: 20_000 },
        mutations: { retry: false },
      },
    });
    keepUnusedData(client);
    expect(client.getDefaultOptions()).toEqual({
      queries: { gcTime: LONGEST_TIMER, staleTime: 20_000 },
      mutations: { retry: false },
    });
  });
});
