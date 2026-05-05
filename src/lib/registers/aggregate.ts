/**
 * Registers — the world's records.
 *
 * Trial-run finding (and post-cycle reflection): the homepage and
 * the wyrm system carry comparative data ("5 souls contributing")
 * but the player has nowhere to *see* who else is contributing
 * what. War of Dragons inspired the *shape* — leaderboards as
 * world records — without importing the grindy framing.
 *
 * Five registers, all readable from existing tables:
 *
 *   1. The Wyrm-fed     — top sum(positive delta) in meta_contributions
 *   2. The Wyrm-starved — top sum(|negative delta|) in meta_contributions
 *   3. The Chronicle    — count of non-redacted, non-expired world_lore
 *                          rows attributed to each user
 *   4. The Refused      — count of finished campaigns whose form was
 *                          forsaken-revenant or the-still-one
 *   5. The Recurring    — for each recurring NPC, the top-3 players
 *                          ranked by times_met (then relationship)
 *
 * All queries are read-only and bounded by LIMIT. No DB writes, no
 * mutations, no caching — call this fresh on every page load until
 * concurrency tells us otherwise.
 */
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  campaigns,
  metaContributions,
  users,
  worldLore,
  worldNpcs,
} from "../db/schema";

export interface RegisterEntry {
  /** 1-based rank within the register. Ties keep their natural order. */
  rank: number;
  /** Player display name. Anonymous / username-less rows are skipped
   *  upstream. */
  username: string;
  /** Numeric value the register ranks on (delta sum, count, etc.). */
  value: number;
  /** Human-readable rendering of `value` ("+12 fed", "3 entries"). */
  formattedValue: string;
  /** Optional one-line context. */
  context?: string;
}

export interface NpcRecurringRegister {
  npcSlug: string;
  /** Best display name we can resolve from world_npcs.data.displayName
   *  → world_npcs.name → slug. */
  npcName: string;
  topPlayers: RegisterEntry[];
}

const DEFAULT_LIMIT = 10;
const RECURRING_NPC_LIMIT = 6;

/** Top players by sum of positive delta (wyrm-feeding behaviour). */
export async function getWyrmFedRegister(
  db: Db,
  limit: number = DEFAULT_LIMIT,
): Promise<RegisterEntry[]> {
  const rows = await db
    .select({
      username: users.username,
      total: sql<number>`SUM(${metaContributions.delta})::int`,
    })
    .from(metaContributions)
    .innerJoin(users, eq(users.id, metaContributions.userId))
    .where(gt(metaContributions.delta, 0))
    .groupBy(users.id, users.username)
    .orderBy(desc(sql`SUM(${metaContributions.delta})`))
    .limit(limit);

  return rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    value: Number(r.total),
    formattedValue: `+${r.total} fed`,
  }));
}

/** Top players by sum of negative delta (wyrm-starving behaviour).
 *  Returns the absolute value for ranking + display. */
export async function getWyrmStarvedRegister(
  db: Db,
  limit: number = DEFAULT_LIMIT,
): Promise<RegisterEntry[]> {
  const rows = await db
    .select({
      username: users.username,
      total: sql<number>`SUM(${metaContributions.delta})::int`,
    })
    .from(metaContributions)
    .innerJoin(users, eq(users.id, metaContributions.userId))
    .where(lt(metaContributions.delta, 0))
    .groupBy(users.id, users.username)
    .orderBy(sql`SUM(${metaContributions.delta}) ASC`)
    .limit(limit);

  return rows.map((r, i) => {
    const abs = Math.abs(Number(r.total));
    return {
      rank: i + 1,
      username: r.username,
      value: abs,
      formattedValue: `-${abs} starved`,
    };
  });
}

/** Top players by count of non-redacted world-lore entries. */
export async function getChronicleRegister(
  db: Db,
  limit: number = DEFAULT_LIMIT,
): Promise<RegisterEntry[]> {
  const rows = await db
    .select({
      username: users.username,
      total: sql<number>`COUNT(${worldLore.id})::int`,
    })
    .from(worldLore)
    .innerJoin(users, eq(users.id, worldLore.sourceUserId))
    .where(
      and(
        eq(worldLore.adminRedacted, false),
        or(
          isNull(worldLore.expiresAt),
          gt(worldLore.expiresAt, new Date()),
        ),
      ),
    )
    .groupBy(users.id, users.username)
    .orderBy(desc(sql`COUNT(${worldLore.id})`))
    .limit(limit);

  return rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    value: Number(r.total),
    formattedValue: `${r.total} ${r.total === 1 ? "entry" : "entries"}`,
  }));
}

/** Players who finished runs as the forsaken-revenant or the-still-one
 *  forms — the "I refused every offer" outcome. */
export async function getRefusedRegister(
  db: Db,
  limit: number = DEFAULT_LIMIT,
): Promise<RegisterEntry[]> {
  const rows = await db
    .select({
      username: users.username,
      total: sql<number>`COUNT(${campaigns.id})::int`,
    })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .where(
      and(
        sql`${campaigns.formId} IN ('forsaken-revenant', 'the-still-one')`,
        sql`${campaigns.status} != 'active'`,
      ),
    )
    .groupBy(users.id, users.username)
    .orderBy(desc(sql`COUNT(${campaigns.id})`))
    .limit(limit);

  return rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    value: Number(r.total),
    formattedValue: `${r.total} ${r.total === 1 ? "refusal" : "refusals"}`,
  }));
}

/** For each recurring NPC, the top-3 players ranked by times_met
 *  (relationship score breaks ties).
 *
 *  We bound the outer set to RECURRING_NPC_LIMIT NPCs by total
 *  cumulative meets, so the page leads with the most-encountered
 *  recurring NPCs first. */
export async function getRecurringNpcRegisters(
  db: Db,
): Promise<NpcRecurringRegister[]> {
  // Top N recurring NPCs by total meets across the world. Drives
  // the registers we render — quieter NPCs don't get their own
  // ledger card unless their slug is hit.
  const topNpcs = await db
    .select({
      slug: worldNpcs.slug,
      totalMeets: sql<number>`SUM(${worldNpcs.timesMet})::int`,
    })
    .from(worldNpcs)
    .where(eq(worldNpcs.isRecurring, true))
    .groupBy(worldNpcs.slug)
    .orderBy(desc(sql`SUM(${worldNpcs.timesMet})`))
    .limit(RECURRING_NPC_LIMIT);

  if (topNpcs.length === 0) return [];

  // Pull the per-(npc, user) rows for those slugs, joined to users.
  // Drizzle's "in" operator on a subquery is awkward here; an
  // explicit text-IN clause is cleaner since the slugs are
  // server-controlled.
  const slugs = topNpcs.map((n) => n.slug);
  const slugList = slugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");

  const rows = await db
    .select({
      slug: worldNpcs.slug,
      name: worldNpcs.name,
      data: worldNpcs.data,
      username: users.username,
      timesMet: worldNpcs.timesMet,
      relationshipScore: worldNpcs.relationshipScore,
    })
    .from(worldNpcs)
    .innerJoin(users, eq(users.id, worldNpcs.userId))
    .where(
      sql`${worldNpcs.isRecurring} = true AND ${worldNpcs.slug} IN (${sql.raw(slugList)})`,
    )
    .orderBy(
      worldNpcs.slug,
      desc(worldNpcs.timesMet),
      desc(worldNpcs.relationshipScore),
    );

  // Bucket by slug, keep top-3 per slug (already pre-ordered).
  const buckets = new Map<string, NpcRecurringRegister>();
  for (const row of rows) {
    const data = (row.data as { displayName?: string }) ?? {};
    const npcName = data.displayName ?? row.name ?? row.slug;
    let bucket = buckets.get(row.slug);
    if (!bucket) {
      bucket = {
        npcSlug: row.slug,
        npcName,
        topPlayers: [],
      };
      buckets.set(row.slug, bucket);
    }
    if (bucket.topPlayers.length >= 3) continue;
    bucket.topPlayers.push({
      rank: bucket.topPlayers.length + 1,
      username: row.username,
      value: row.timesMet,
      formattedValue: `${row.timesMet} ${row.timesMet === 1 ? "meeting" : "meetings"}`,
      context:
        row.relationshipScore !== 0
          ? `relationship ${row.relationshipScore > 0 ? "+" : ""}${row.relationshipScore}`
          : undefined,
    });
  }

  // Preserve the topNpcs order in the response.
  return topNpcs
    .map((n) => buckets.get(n.slug))
    .filter((b): b is NpcRecurringRegister => b !== undefined);
}

/** Single bundled fetch — used by /api/registers and the /registers
 *  page so the client makes one request, not five. */
export async function getAllRegisters(db: Db) {
  const [wyrmFed, wyrmStarved, chronicle, refused, recurring] =
    await Promise.all([
      getWyrmFedRegister(db),
      getWyrmStarvedRegister(db),
      getChronicleRegister(db),
      getRefusedRegister(db),
      getRecurringNpcRegisters(db),
    ]);
  return { wyrmFed, wyrmStarved, chronicle, refused, recurring };
}
