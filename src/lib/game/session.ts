/**
 * Session-creation helper. Called by /api/session.
 *
 * Creates a sessions row + emits the initial session.started event,
 * which carries the per-session PRNG seed (used by deriveSeed in
 * turn.ts). Uses crypto-strong randomness for the seed.
 *
 * `locationId` and `reincarnatedAs` are stored on the sessions row so
 * anon (campaign-less) sessions still get the open-ended start —
 * resolveSessionContext falls back to these when no campaign is
 * attached. For logged-in sessions, the campaign supersedes them.
 */
import { randomBytes } from "node:crypto";

import { sessions } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

import { appendEvents } from "./events";
import type { Db } from "../db/client";

export interface CreateSessionResult {
  sessionId: string;
  formId: string;
  seed: number;
}

export async function createSession(
  db: Db,
  formId: string,
  opts: { locationId?: string; reincarnatedAs?: string | null } = {},
): Promise<CreateSessionResult> {
  const sessionId = uuidv7();
  const seed = randomBytes(4).readUInt32BE(0);
  const cookieHmac = uuidv7().replace(/-/g, "");

  // Anon sessions start at the BLESSED-free cap (40) — same lure
  // logic as registered users. The blessing fades after 7 days from
  // sessions.startedAt.
  const { effectiveTier, getTier } = await import(
    "../energy/tiers"
  );
  const blessedFree = effectiveTier(getTier("free"), new Date()).tier;
  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac,
    formId,
    energy: blessedFree.max,
    ...(opts.locationId ? { locationId: opts.locationId } : {}),
    ...(opts.reincarnatedAs !== undefined
      ? { reincarnatedAs: opts.reincarnatedAs }
      : {}),
  });
  await appendEvents(db, sessionId, [
    { kind: "session.started", formId, seed },
  ]);

  return { sessionId, formId, seed };
}
