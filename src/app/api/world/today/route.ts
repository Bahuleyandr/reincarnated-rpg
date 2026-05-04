/**
 * GET /api/world/today — public, no auth.
 *
 * Recent noteworthy world events from the last 24 UTC hours: sessions
 * that ended (death / win / cap), big roll outcomes (10+/2-), notable
 * tools fired (npc.introduced for threat templates, beat fires).
 *
 * Aggressively cached (5min) — the events table is append-only so a
 * 5min staleness is fine and load on the events index stays bounded.
 *
 * Anonymized: usernames omitted unless the user has opted-in via
 * `users.show_in_lobby`. Sessions that haven't been claimed by a user
 * are described by their `reincarnatedAs` declaration if set, else by
 * their formId. Privacy by default.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { cached } from "@/lib/util/cache";

interface TickerEntry {
  /** Stable key for React lists. */
  id: string;
  /** Short prose for the marquee. */
  text: string;
  /** UTC ISO of when this happened. */
  at: string;
  /** Categorical tag for optional filtering / styling. */
  kind: "death" | "win" | "cap" | "roll-success" | "roll-miss" | "lore";
}

const HORIZON_HOURS = 24;
const MAX_ENTRIES = 25;

export async function GET() {
  const payload = await cached(
    "world:today:v1",
    5 * 60 * 1000,
    async () => buildTicker(),
  );
  return NextResponse.json(payload);
}

async function buildTicker(): Promise<{ entries: TickerEntry[]; horizonHours: number }> {
  const horizon = new Date(Date.now() - HORIZON_HOURS * 60 * 60 * 1000);

  // session.ended events with their session's form + reincarnatedAs.
  // We use raw SQL for the JSON kind/payload extraction since events
  // is heterogeneous and Drizzle's typed selects work poorly on it.
  const rows = (await db.$client`
    SELECT
      e.id              AS event_id,
      e.session_id      AS session_id,
      e.created_at      AS at,
      e.kind            AS kind,
      e.payload         AS payload,
      s.form_id         AS form_id,
      s.reincarnated_as AS reincarnated_as
    FROM events e
    JOIN sessions s ON s.id = e.session_id
    WHERE e.created_at > ${horizon.toISOString()}::timestamptz
      AND e.kind IN ('session.ended', 'roll.resolved')
    ORDER BY e.created_at DESC
    LIMIT 200
  `) as Array<{
    event_id: string;
    session_id: string;
    at: Date;
    kind: string;
    payload: unknown;
    form_id: string | null;
    reincarnated_as: string | null;
  }>;

  const entries: TickerEntry[] = [];
  for (const row of rows) {
    if (entries.length >= MAX_ENTRIES) break;
    const subject = row.reincarnated_as?.trim() || row.form_id || "a soul";
    const data = (row.payload ?? {}) as Record<string, unknown>;

    if (row.kind === "session.ended") {
      const reason = data.reason as string | undefined;
      if (reason === "death") {
        entries.push({
          id: `e-${row.event_id}`,
          at: row.at.toISOString(),
          kind: "death",
          text: `${subject} fell.`,
        });
      } else if (reason === "won") {
        entries.push({
          id: `e-${row.event_id}`,
          at: row.at.toISOString(),
          kind: "win",
          text: `${subject} survived the night.`,
        });
      } else if (reason === "cap") {
        entries.push({
          id: `e-${row.event_id}`,
          at: row.at.toISOString(),
          kind: "cap",
          text: `${subject} reached the turn cap, no verdict.`,
        });
      }
    } else if (row.kind === "roll.resolved") {
      const roll = data.roll as { total?: number; band?: string } | undefined;
      const band = roll?.band;
      const total = roll?.total ?? 0;
      // Only the very-good (12+) and very-bad (2-) rolls make the ticker.
      if (band === "success" && total >= 12) {
        entries.push({
          id: `e-${row.event_id}`,
          at: row.at.toISOString(),
          kind: "roll-success",
          text: `${subject} rolled a ${total} — the world bends.`,
        });
      } else if (band === "miss" && total <= 3) {
        entries.push({
          id: `e-${row.event_id}`,
          at: row.at.toISOString(),
          kind: "roll-miss",
          text: `${subject} rolled a ${total} — the world refuses.`,
        });
      }
    }
  }

  return { entries, horizonHours: HORIZON_HOURS };
}
