import { createHash, timingSafeEqual } from "node:crypto";

import { sign, verifySignature } from "../ids";
import { newCompanyCode } from "../signup/code";

// The eight digits typed with a cell number. They are made like the company's
// code (random, never an obvious run). A personal invitation's code is kept
// as a digest keyed with the server's secret and bound to its invitation: a
// plain hash of eight digits is undone by trying all hundred million.

export const newAccessCode = newCompanyCode;

/** What invites.code_hash holds for this invitation's code. */
export const accessCodeDigest = (inviteId: string, code: string) =>
  sign(`access-code:${inviteId}:${code}`);

/** Whether the code typed is this invitation's, compared in constant time. */
export const isInviteCode = (inviteId: string, digest: string, typed: string) =>
  verifySignature(`access-code:${inviteId}:${typed}`, digest);

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Whether two codes kept as they are (the demonstration's) match, in constant time. */
export const sameCode = (typed: string, expected: string) =>
  timingSafeEqual(digest(typed), digest(expected));
