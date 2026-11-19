// Calls to the app's own API. Every failure becomes an ApiFailure, so screens
// can tell "no network" from "not allowed" from "the server said why".

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  /** The request never reached the server (no signal, server down). */
  get offline() {
    return this.status === 0;
  }
}

/** Fired when the server says this device is no longer signed in. */
export const SIGNED_OUT_EVENT = "ead:signed-out";

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiFailure(0, "offline", "Pas de réseau. Réessayez quand la connexion revient.");
  }
  if (response.ok) return (await response.json()) as T;

  let code = "error";
  let message = "Une erreur est survenue. Réessayez.";
  try {
    const data = await response.json();
    if (data?.error) ({ code, message } = data.error);
  } catch {
    // An error page that is not ours (a proxy, a timeout): keep the default.
  }
  if (response.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  throw new ApiFailure(response.status, code, message);
}

/** A sentence to show for any thrown value. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiFailure ? error.message : "Une erreur est survenue. Réessayez.";
}
