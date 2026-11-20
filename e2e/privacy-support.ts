import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";

import { contextAs, post, seed } from "./support";

// Helpers of the privacy specs (e2e/legal.spec.ts).

let made = 0;

/**
 * A foreman of the main project made for one test, signed in on a context of
 * their own: the seeded foreman has already agreed to the assistant, and the
 * question must be asked of someone who has not.
 */
export async function newForeman(
  browser: Browser,
  options: Parameters<Browser["newContext"]>[0] = {},
): Promise<{ context: BrowserContext; name: string }> {
  const admin = await contextAs(browser, "admin");
  // Letters only: a name, whatever the rules for names become.
  const tag = (Date.now() + made++)
    .toString(26)
    .replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 26)));
  const name = `Essai ${tag[0].toUpperCase()}${tag.slice(1)}`;
  const person = await post<{ invite: { url: string } }>(admin.request, "/api/users", {
    name,
    role: "contremaitre",
    projectIds: [seed.projectId],
  });
  await admin.close();
  const context = await browser.newContext({ ...options, baseURL: seed.base });
  await post(context.request, `/api/invites/${person.invite.url.split("/i/")[1]}`, {});
  return { context, name };
}

/** A day with no report, far from the seeded ones and from the other specs'. */
export function freeDay(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(date);
}

/** PUT as JSON, the way the app does; a refusal is an answer, never thrown. */
export async function put<T = unknown>(
  request: APIRequestContext | BrowserContext["request"],
  path: string,
  data: unknown,
): Promise<{ status: number; body: T }> {
  const response = await request.put(path, { data, headers: { origin: seed.base } });
  return { status: response.status(), body: (await response.json().catch(() => null)) as T };
}
