/**
 * Event log helpers.
 *
 * `appendEvents` reads MAX(seq) for the session, assigns sequential
 * `seq` values starting at max+1, and inserts the batch in a single
 * transaction. The unique (session_id, seq) index catches concurrent
 * writers — they'll collide on insert and the second writer can retry.
 * For v0.1 there's at most one appender per session (the orchestrator
 * runs serially per /api/turn call), so contention is theoretical.
 *
 * `readLog` returns rows in seq order. With `fromSeq` it filters to
 * seq > fromSeq (used by snapshot+delta replay).
 *
 * `validateContiguous` is a debug helper for replay-from-zero
 * diagnostics; production paths shouldn't need it because the trigger
 * + unique index + transaction make gaps impossible.
 */
import { and, asc, eq, gt, max } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";

import { events as eventsTable } from "../db/schema";
import type { EventRow, NewEventRow } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

import type { Event, EventKind } from "./types";

type Db = ReturnType<typeof drizzle>;

export interface AppendedEvent {
  event: Event;
  seq: number;
  id: string;
  createdAt: Date;
}

export async function appendEvents(
  db: Db,
  sessionId: string,
  batch: Event[],
): Promise<AppendedEvent[]> {
  if (batch.length === 0) return [];

  return db.transaction(async (tx) => {
    const [{ maxSeq }] = await tx
      .select({ maxSeq: max(eventsTable.seq) })
      .from(eventsTable)
      .where(eq(eventsTable.sessionId, sessionId));

    let seq = maxSeq ?? 0;
    const rows: NewEventRow[] = batch.map((event) => {
      seq += 1;
      const { kind, payload, seed } = splitEvent(event);
      return {
        id: uuidv7(),
        sessionId,
        seq,
        kind,
        payload,
        seed: seed ?? null,
      };
    });

    const inserted = await tx
      .insert(eventsTable)
      .values(rows)
      .returning({
        id: eventsTable.id,
        seq: eventsTable.seq,
        createdAt: eventsTable.createdAt,
      });

    return inserted.map((r, i) => ({
      event: batch[i],
      seq: r.seq,
      id: r.id,
      createdAt: r.createdAt,
    }));
  });
}

export async function readLog(
  db: Db,
  sessionId: string,
  fromSeq?: number,
): Promise<EventRow[]> {
  const where =
    fromSeq !== undefined && fromSeq > 0
      ? and(eq(eventsTable.sessionId, sessionId), gt(eventsTable.seq, fromSeq))
      : eq(eventsTable.sessionId, sessionId);
  return db.select().from(eventsTable).where(where).orderBy(asc(eventsTable.seq));
}

/**
 * Diagnostic — returns true iff seqs are 1..N contiguous starting at startSeq.
 * Production paths shouldn't need this; the triggers + unique index +
 * appendEvents transaction make gaps impossible.
 */
export function validateContiguous(rows: EventRow[], startSeq = 1): boolean {
  let expected = startSeq;
  for (const r of rows) {
    if (r.seq !== expected) return false;
    expected += 1;
  }
  return true;
}

/**
 * Convert a domain Event into the {kind, payload, seed} shape the DB row
 * stores. `kind` is the discriminator; `payload` is everything else minus
 * `seed`, which lives in its own column to support BIGINT semantics.
 */
function splitEvent(event: Event): {
  kind: EventKind;
  payload: Record<string, unknown>;
  seed?: number;
} {
  const { kind, ...rest } = event;
  // Some event kinds carry a top-level `seed` field; strip it into its own slot.
  if ("seed" in rest && typeof rest.seed === "number") {
    const { seed, ...payload } = rest;
    return { kind, payload, seed };
  }
  return { kind, payload: rest as Record<string, unknown> };
}

/**
 * Reverse of splitEvent — reconstruct an Event from a stored row.
 * Used by projection replay.
 */
export function rowToEvent(row: EventRow): Event {
  const base: Record<string, unknown> = {
    kind: row.kind,
    ...(row.payload as Record<string, unknown>),
  };
  if (row.seed != null) base.seed = row.seed;
  return base as Event;
}
