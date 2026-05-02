/**
 * Session-creation helper. Called by /api/session.
 *
 * Creates a sessions row + emits the initial session.started event,
 * which carries the per-session PRNG seed (used by deriveSeed in
 * turn.ts). Uses crypto-strong randomness for the seed.
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
): Promise<CreateSessionResult> {
  const sessionId = uuidv7();
  const seed = randomBytes(4).readUInt32BE(0);
  const cookieHmac = uuidv7().replace(/-/g, "");

  await db.insert(sessions).values({
    id: sessionId,
    cookieHmac,
    formId,
  });
  await appendEvents(db, sessionId, [
    { kind: "session.started", formId, seed },
  ]);

  return { sessionId, formId, seed };
}
