import { readFileSync } from "node:fs";

import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";

/** Where scripts/e2e.sh had the seed script leave the sessions and ids. */
const DIR = process.env.SEED_OUT ?? ".data/e2e";

export type Role = "admin" | "foreman" | "worker";

export const seed = JSON.parse(readFileSync(`${DIR}/seed.json`, "utf8")) as {
  base: string;
  projectId: string;
  otherProjectIds: string[];
  sheetIds: string[];
  people: Record<Role, string>;
};

/** The saved browser session of one of the seeded people. */
export const sessionOf = (role: Role) => `${DIR}/${role}.json`;

/** A browser context signed in as someone, with the test's device settings. */
export function contextAs(
  browser: Browser,
  role: Role,
  options: Parameters<Browser["newContext"]>[0] = {},
) {
  return browser.newContext({ ...options, storageState: sessionOf(role) });
}

/** POST as JSON, the way the app does (the API checks the origin of writes). */
export async function post<T = unknown>(
  request: APIRequestContext | BrowserContext["request"],
  path: string,
  data: unknown = {},
) {
  const response = await request.post(path, { data, headers: { origin: seed.base } });
  if (!response.ok())
    throw new Error(`POST ${path} → ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

/**
 * Any API call, sent the way the app sends it. Unlike `post`, it never
 * throws: a refusal is an answer, to be looked at.
 */
export async function call<T = any>( // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON in tests
  request: APIRequestContext | BrowserContext["request"],
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  data?: unknown,
): Promise<{ status: number; body: T; headers: Record<string, string> }> {
  const response = await request.fetch(path, { method, data, headers: { origin: seed.base } });
  const body = await response.json().catch(() => null);
  return { status: response.status(), body, headers: response.headers() };
}

/**
 * A clean device (nobody signed in) on a network address of its own: the
 * door of account creation counts tries per address, and a test must not
 * spend another's.
 */
export function deviceAt(
  browser: Browser,
  address: string,
  options: Parameters<Browser["newContext"]>[0] = {},
) {
  return browser.newContext({
    ...options,
    baseURL: seed.base,
    extraHTTPHeaders: { ...options.extraHTTPHeaders, "x-forwarded-for": address },
  });
}
