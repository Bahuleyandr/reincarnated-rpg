import { randomUUID } from "node:crypto";

import type { Db } from "../db/client";

export interface TurnLock {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

export async function acquireTurnLock(
  db: Db,
  sessionId: string,
  ttlMs = 90_000,
): Promise<TurnLock | null> {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = (await db.$client`
    UPDATE sessions
       SET turn_lock_token = ${token},
           turn_lock_expires_at = ${expiresAt}
     WHERE id = ${sessionId}
       AND (
         turn_lock_expires_at IS NULL
         OR turn_lock_expires_at < now()
       )
     RETURNING id
  `) as Array<{ id: string }>;

  if (rows.length === 0) return null;
  return { sessionId, token, expiresAt };
}

export async function releaseTurnLock(
  db: Db,
  lock: TurnLock | null,
): Promise<void> {
  if (!lock) return;
  await db.$client`
    UPDATE sessions
       SET turn_lock_token = NULL,
           turn_lock_expires_at = NULL
     WHERE id = ${lock.sessionId}
       AND turn_lock_token = ${lock.token}
  `;
}
