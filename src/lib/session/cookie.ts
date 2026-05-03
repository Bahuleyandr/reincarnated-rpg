/**
 * Signed-cookie auth via `jose` HS256.
 *
 * Two cookie shapes both fit the same payload:
 *   - Anon play: `{ sessionId }` — current /api/session flow.
 *   - Logged-in: `{ userId, sessionId? }` — set after auth/login;
 *     sessionId may also be set if the user is mid-run.
 *
 * Both consumers and writers should treat the payload as
 * `{ userId?, sessionId? }` — at least one must be present.
 */
import { jwtVerify, SignJWT } from "jose";

import { env } from "../util/env";

const ALG = "HS256";
const COOKIE_NAME = "session";
const TTL_DAYS = 30;

export interface SessionCookiePayload {
  /** Set when the user has signed in. Stable across runs. */
  userId?: string;
  /** Set during an active anon session, or for a logged-in user
   *  currently mid-run. */
  sessionId?: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function mintCookie(
  payload: SessionCookiePayload,
): Promise<string> {
  if (!payload.userId && !payload.sessionId) {
    throw new Error("cookie payload must include userId or sessionId");
  }
  const claims: Record<string, string> = {};
  if (payload.userId) claims.userId = payload.userId;
  if (payload.sessionId) claims.sessionId = payload.sessionId;
  return new SignJWT(claims)
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
    const userId =
      typeof payload.userId === "string" ? payload.userId : undefined;
    const sessionId =
      typeof payload.sessionId === "string" ? payload.sessionId : undefined;
    if (!userId && !sessionId) return null;
    return { userId, sessionId };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_COOKIE_TTL_DAYS = TTL_DAYS;
