import Anthropic from "@anthropic-ai/sdk";
import { getVercelOidcToken } from "@vercel/oidc";

// The app's AI features go through Vercel AI Gateway: on Vercel the
// deployment signs in by itself (OIDC), so there is no key to manage, and
// usage is billed with the hosting. Elsewhere, AI_GATEWAY_API_KEY does it.

const GATEWAY = "https://ai-gateway.vercel.sh";

/** The Claude model used to write reports from what was said. */
export const CLAUDE_MODEL = "anthropic/claude-opus-5.5";
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

/** Whether the AI service can be reached from here. */
export async function aiAvailable(): Promise<boolean> {
  return aiIsFake() || (await gatewayToken()) !== null;
}

/** A Claude client, or null where no AI service is configured. */
export async function claude(): Promise<Anthropic | null> {
  const token = await gatewayToken();
  if (!token) return null;
  // The token is short-lived on Vercel: a client is made per request.
  return new Anthropic({ apiKey: token, baseURL: GATEWAY, timeout: 45_000, maxRetries: 1 });
}
