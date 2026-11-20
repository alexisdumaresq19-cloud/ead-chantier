import Anthropic from "@anthropic-ai/sdk";
import { getVercelOidcToken } from "@vercel/oidc";

// The app's AI features go through Vercel AI Gateway: on Vercel the
// deployment signs in by itself (OIDC), so there is no key to manage, and
// usage is billed with the hosting. Elsewhere, AI_GATEWAY_API_KEY does it.

const GATEWAY = "https://ai-gateway.vercel.sh";

/**
 * The Claude model used to write reports from what was said and seen.
 * AI_MODEL names another one of the gateway's catalog (its faster variant,
 * for instance) without a change to the code.
 */
export const CLAUDE_MODEL = process.env.AI_MODEL?.trim() || "anthropic/claude-opus-5.5";
/** The speech-to-text model. */
export const TRANSCRIPTION_MODEL = "openai/gpt-transcribe";

/** Tests run without any AI service: answers are then made up locally. */
export const aiIsFake = () => process.env.AI_FAKE === "1";

async function gatewayToken(): Promise<string | null> {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
  try {
    return await getVercelOidcToken();
  } catch {
    return null;
  }
}

// When the service turns this deployment away (no payment method on the
// account, access withdrawn), the screens stop offering what depends on it
// for a while instead of failing at every try. Kept in memory: each server
// instance learns it at its first refusal.
const REFUSAL_HOLD = 10 * 60 * 1000;
let refusedUntil = 0;

/** To be called when the AI service answers that this account may not use it (401, 402, 403). */
export function noteAiRefused() {
  refusedUntil = Date.now() + REFUSAL_HOLD;
}

/** Whether a failure's HTTP status means "this account may not use the service". */
export const isAiRefusal = (status: number | undefined) =>
  status === 401 || status === 402 || status === 403;

/** Whether the AI service can be used from here. */
export async function aiAvailable(): Promise<boolean> {
  if (aiIsFake()) return true;
  return Date.now() >= refusedUntil && (await gatewayToken()) !== null;
}

/** A Claude client, or null where no AI service is configured. */
export async function claude(): Promise<Anthropic | null> {
  const token = await gatewayToken();
  if (!token) return null;
  // The token is short-lived on Vercel: a client is made per request.
  return new Anthropic({ apiKey: token, baseURL: GATEWAY, timeout: 45_000, maxRetries: 1 });
}
