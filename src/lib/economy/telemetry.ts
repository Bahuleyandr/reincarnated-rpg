/**
 * Economy telemetry — daily coin-flow rollup.
 *
 * Each turn emits zero or more coin events (`coins.gained`,
 * `coins.spent`, `trade.completed`). The orchestrator calls
 * `rollupCoinEvents` after `appendEvents` to aggregate by source
 * tag and upsert into `coin_flow_daily`. The /god/economy admin
 * dashboard reads this table.
 *
 * Phase 5 Day 26.
 */
import { sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { coinFlowDaily } from "../db/schema";
import type { Event } from "../game/types";

/**
 * Group a turn's coin events by source tag and produce a flat list
 * of per-source deltas. trade.completed events are bucketed by the
 * vendor source (`vendor:<templateId>`) when we can derive it,
 * otherwise they fall under "trade" generically.
 */
export interface CoinFlowDelta {
  source: string;
  amount: number;
  count: number;
}

export function summarizeCoinEvents(
  events: ReadonlyArray<Event>,
): CoinFlowDelta[] {
  const byKey = new Map<string, CoinFlowDelta>();
  function bump(source: string, amount: number) {
    const cur = byKey.get(source);
    if (cur) {
      cur.amount += amount;
      cur.count += 1;
    } else {
      byKey.set(source, { source, amount, count: 1 });
    }
  }
  for (const e of events) {
    if (e.kind === "coins.gained") bump(e.source, e.amount);
    else if (e.kind === "coins.spent") bump(e.sink, -e.amount);
    // trade.completed is double-bucketed via the companion
    // coins.gained / coins.spent in the same batch — don't add
    // again here. Buying or selling without those companion events
    // (manual emission via test fixtures) is rare; in that case
    // the trade is invisible to telemetry. Acceptable v1.
  }
  return Array.from(byKey.values());
}

/**
 * Upsert all summarized deltas into `coin_flow_daily`. The
 * primary key is (date, source); concurrent updates with
 * different sources don't conflict, same-source rows merge
 * via the conflict update.
 */
export async function rollupCoinEvents(
  db: Db,
  events: ReadonlyArray<Event>,
  /** Override for tests; defaults to UTC today. */
  date: string = todayUtc(),
): Promise<void> {
  const deltas = summarizeCoinEvents(events);
  if (deltas.length === 0) return;
  // Upsert one row at a time — Postgres-js doesn't expose multi-row
  // upserts cleanly through Drizzle's onConflictDoUpdate, and the
  // turn batch is small (typically 1-2 sources per turn).
  for (const d of deltas) {
    await db
      .insert(coinFlowDaily)
      .values({
        date,
        source: d.source,
        totalAmount: d.amount,
        txnCount: d.count,
      })
      .onConflictDoUpdate({
        target: [coinFlowDaily.date, coinFlowDaily.source],
        set: {
          totalAmount: sql`${coinFlowDaily.totalAmount} + ${d.amount}`,
          txnCount: sql`${coinFlowDaily.txnCount} + ${d.count}`,
        },
      });
  }
}

function todayUtc(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export interface DailyEconomySnapshot {
  date: string;
  /** Sum of all positive amount entries (coins minted into player purses). */
  inflow: number;
  /** Sum of all negative amount entries (coins removed from player purses). */
  outflow: number;
  /** Net delta: inflow + outflow (outflow is already negative). */
  net: number;
  /** Top 5 sources by absolute amount. */
  topSources: CoinFlowDelta[];
}

/**
 * Read a single day's rollup. Used by the /god/economy admin page.
 */
export async function readDailyEconomy(
  db: Db,
  date: string = todayUtc(),
): Promise<DailyEconomySnapshot> {
  const rows = (await db.execute(sql`
    SELECT source, total_amount, txn_count
    FROM coin_flow_daily
    WHERE date = ${date}::date
    ORDER BY ABS(total_amount) DESC
  `)) as unknown as Array<{
    source: string;
    total_amount: number | string;
    txn_count: number;
  }>;

  let inflow = 0;
  let outflow = 0;
  const all: CoinFlowDelta[] = rows.map((r) => {
    const amt = Number(r.total_amount);
    if (amt >= 0) inflow += amt;
    else outflow += amt;
    return { source: r.source, amount: amt, count: r.txn_count };
  });
  return {
    date,
    inflow,
    outflow,
    net: inflow + outflow,
    topSources: all.slice(0, 5),
  };
}
