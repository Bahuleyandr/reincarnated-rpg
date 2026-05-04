#!/usr/bin/env ts-node
/**
 * scripts/replay-from-zero.ts — Phase 8 Day 64.
 *
 * Replay every event in the log from seq=0 for a given session and
 * verify the resulting projection matches the cached snapshot. CI
 * runs this nightly across a sampled set of completed sessions to
 * catch reducer regressions.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/replay-from-zero.ts <sessionId>
 *   DATABASE_URL=... npx tsx scripts/replay-from-zero.ts --random 10
 */
import "../scripts/load-env";

import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import { projections } from "../src/lib/db/schema";
import { loadForm, loadLocation } from "../src/lib/game/content";
import { readLog, rowToEvent } from "../src/lib/game/events";
import {
  applyEvents,
  initialProjection,
} from "../src/lib/game/projection";
import { resolveSessionContext } from "../src/lib/game/campaign-context";

interface Mismatch {
  sessionId: string;
  field: string;
  cached: unknown;
  replayed: unknown;
}

async function checkSession(
  db: ReturnType<typeof drizzle>,
  sessionId: string,
): Promise<Mismatch[]> {
  const ctx = await resolveSessionContext(db as never, sessionId);
  const form = loadForm(ctx.formId);
  const location = loadLocation(ctx.locationId);
  const eventsRows = await readLog(db as never, sessionId);
  const events = eventsRows.map(rowToEvent);
  const initial = initialProjection({
    sessionId,
    form,
    location,
    reincarnatedAs: ctx.reincarnatedAs,
  });
  const replayed = applyEvents(initial, events);
  const [snap] = await db
    .select()
    .from(projections)
    .where(eq(projections.sessionId, sessionId))
    .limit(1);
  if (!snap) return [];
  const cached = snap.state as typeof replayed;
  const mismatches: Mismatch[] = [];
  // Compare a small set of well-defined fields.
  const fields: Array<keyof typeof replayed> = [
    "turn",
    "status",
    "xp",
  ];
  for (const f of fields) {
    if (JSON.stringify(cached[f]) !== JSON.stringify(replayed[f])) {
      mismatches.push({
        sessionId,
        field: String(f),
        cached: cached[f],
        replayed: replayed[f],
      });
    }
  }
  // Inventory: same itemIds + qtys (order may differ).
  const sortInv = (
    list: ReadonlyArray<{ itemId: string; qty: number }>,
  ): string =>
    [...list].sort((a, b) => a.itemId.localeCompare(b.itemId))
      .map((i) => `${i.itemId}x${i.qty}`).join(",");
  if (sortInv(cached.inventory) !== sortInv(replayed.inventory)) {
    mismatches.push({
      sessionId,
      field: "inventory",
      cached: cached.inventory,
      replayed: replayed.inventory,
    });
  }
  return mismatches;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const sql_ = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(sql_);

  const args = process.argv.slice(2);
  let sessionIds: string[] = [];
  if (args[0] === "--random") {
    const n = Math.max(1, Number.parseInt(args[1] ?? "10", 10));
    const rows = (await db.execute(sql`
      SELECT id FROM sessions ORDER BY random() LIMIT ${n}
    `)) as unknown as Array<{ id: string }>;
    sessionIds = rows.map((r) => r.id);
  } else if (args.length > 0) {
    sessionIds = args;
  } else {
    console.error(
      "usage: replay-from-zero <sessionId>... | --random <N>",
    );
    process.exit(1);
  }

  let totalMismatches = 0;
  for (const sid of sessionIds) {
    const m = await checkSession(db, sid);
    if (m.length > 0) {
      totalMismatches += m.length;
      console.error(`✗ ${sid}: ${m.length} mismatch(es)`);
      for (const x of m) {
        console.error(
          `  - ${x.field}: cached=${JSON.stringify(x.cached)} replayed=${JSON.stringify(x.replayed)}`,
        );
      }
    } else {
      console.log(`✓ ${sid}`);
    }
  }
  await sql_.end();
  if (totalMismatches > 0) process.exit(1);
}

void main();
