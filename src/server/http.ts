import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";

// Validation messages reach people: they are in French like the rest.
z.config(z.locales.fr());

/** An error the client is meant to see, with its HTTP status. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request") =>
  new HttpError(400, code, message);
export const unauthorized = () => new HttpError(401, "unauthorized", "Connexion requise.");
export const forbidden = (message = "Vous n'avez pas accès à ceci.") =>
  new HttpError(403, "forbidden", message);
export const notFound = (message = "Introuvable.") => new HttpError(404, "not_found", message);

/**
 * Wraps a route handler: awaits the route params, turns thrown HttpErrors and
 * validation errors into JSON, and refuses writes that come from another site.
 */
export function route<P = Record<string, never>>(
  fn: (request: NextRequest, params: P) => Promise<unknown>,
) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    try {
      assertSameOrigin(request);
      const params = await context.params;
      assertPlainParams(params);
      const result = await fn(request, params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof HttpError) {
        return NextResponse.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      }
      if (error instanceof ZodError) {
        const first = error.issues[0];
        const where = first?.path.length ? `${first.path.join(".")} : ` : "";
        return NextResponse.json(
          {
            error: {
              code: "invalid",
              message: `Données invalides (${where}${first?.message ?? ""}).`,
            },
          },
          { status: 400 },
        );
      }
      console.error(`${request.method} ${request.nextUrl.pathname}`, error);
      return NextResponse.json(
        { error: { code: "server_error", message: "Une erreur est survenue. Réessayez." } },
        { status: 500 },
      );
    }
  };
}

/**
 * Ids, tokens and days in an address are plain ASCII words. Anything else (a
 * NUL byte, a 2 kB string) cannot name a record: it is a 404, not a query.
 */
function assertPlainParams(params: unknown) {
  for (const value of Object.values(params ?? {}))
    if (typeof value === "string" && !/^[\w.~-]{1,200}$/.test(value)) throw notFound();
}

/**
 * The session cookie is SameSite=Lax, which already keeps it out of
 * cross-site POSTs; this also rejects any write whose Origin is not ours.
 */
function assertSameOrigin(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("origin");
  if (!origin) return; // not a browser (curl, tests, server-to-server)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (new URL(origin).host !== host) throw forbidden("Requête refusée.");
}

export async function body<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  let data: unknown;
  try {
    data = await request.json();
  } catch {
    throw badRequest("Corps de requête illisible.");
  }
  return schema.parse(data);
}

/** The site's public address, as the browser sees it (for links and QR codes). */
export function originOf(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
