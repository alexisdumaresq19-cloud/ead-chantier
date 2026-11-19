import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "./env";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes (i, l, o, 0, 1)

/** A short random id for a record: 16 characters, about 79 bits. */
export function newId(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** A secret for a link or a cookie: 32 random bytes, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** An unguessable folder name for files served without a login check. */
export function newPublicKey(prefix: string): string {
  return `${prefix}/${randomBytes(18).toString("base64url")}`;
}

/** Tokens are stored hashed, so a database leak does not open sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function sign(payload: string): string {
  return createHmac("sha256", env.appSecret).update(payload).digest("base64url");
}

export function verifySignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
