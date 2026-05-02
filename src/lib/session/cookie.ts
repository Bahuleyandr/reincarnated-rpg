/**
 * Anon session cookies, signed with HS256 via `jose`.
 *
 * The cookie payload is `{ sessionId }`. The cookie itself is HMAC'd
 * with `SESSION_SECRET` so a tampered ID is rejected on verify.
 *
 * v0.1 is single-form anon-only — no claim-account flow yet (M3).
 */
import { jwtVerify, SignJWT } from "jose";

import { env } from "../util/env";

const ALG = "HS256";
const COOKIE_NAME = "session";
const TTL_DAYS = 30;

export interface SessionCookiePayload {
  sessionId: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function mintCookie(
  payload: SessionCookiePayload,
): Promise<string> {
  return new SignJWT({ sessionId: payload.sessionId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_DAYS}d`)
    .sign(secret());
}

export async function verifyCookie(
  token: string,
): Promise<SessionCookiePayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    if (typeof payload.sessionId !== "string") return null;
    return { sessionId: payload.sessionId };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_COOKIE_TTL_DAYS = TTL_DAYS;
