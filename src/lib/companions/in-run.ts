/**
 * In-run companions (Roadmap item 64).
 *
 * Bonded NPCs (world_npcs.bonded_at IS NOT NULL) can be summoned
 * into the active session as actual party members. Each summoned
 * companion has its own HP + level scaled by their interaction
 * history. They take damage during play (via damageCompanion)
 * and die permanently when HP hits zero.
 *
 * Design constraints:
 *   - Idempotent on (sessionId, worldNpcId) PK — second summon
 *     of the same companion is a no-op.
 *   - Death is two-sided: session_companions.status='dead' AND
 *     world_npcs.last_seen_status='dead' (the bond doesn't bring
 *     them back).
 *   - Level-up happens on session.ended (won) — every alive
 *     companion gains a level. Capped at level 5 for now.
 */
import { and, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { sessionCompanions, worldNpcs } from "../db/schema";

export const COMPANION_HP_BASE = 6;
export const COMPANION_HP_PER_LEVEL = 2;
export const COMPANION_MAX_LEVEL = 5;

export interface CompanionRow {
  worldNpcId: string;
  slug: string;
  displayName: string;
  level: number;
  currentHp: number;
  maxHp: number;
  status: "alive" | "dead" | "left";
  joinedAtTurn: number;
}

function hpForLevel(level: number): number {
  return COMPANION_HP_BASE + (level - 1) * COMPANION_HP_PER_LEVEL;
}

export type SummonResult =
  | { ok: true; row: CompanionRow }
  | {
      ok: false;
      error:
        | "not_bonded"
        | "world_npc_not_found"
        | "already_dead"
        | "already_summoned";
    };

/**
 * Summon a bonded NPC into the current session. Validates that
 * the NPC is bonded and not already dead. Idempotent: second
 * call with the same (sessionId, worldNpcId) returns
 * already_summoned.
 *
 * Level is read from world_npcs.times_met (clamped to
 * COMPANION_MAX_LEVEL) so well-known companions show up tougher.
 * HP starts at hpForLevel(level).
 */
export async function summonCompanion(
  db: Db,
  args: {
    sessionId: string;
    userId: string;
    worldNpcSlug: string;
    turn: number;
  },
): Promise<SummonResult> {
  const [npc] = await db
    .select()
    .from(worldNpcs)
    .where(
      and(
        eq(worldNpcs.userId, args.userId),
        eq(worldNpcs.slug, args.worldNpcSlug),
      ),
    )
    .limit(1);
  if (!npc) return { ok: false, error: "world_npc_not_found" };
  if (!npc.bondedAt) return { ok: false, error: "not_bonded" };
  if (npc.lastSeenStatus === "dead") {
    return { ok: false, error: "already_dead" };
  }

  // Already-summoned check.
  const [existing] = await db
    .select()
    .from(sessionCompanions)
    .where(
      and(
        eq(sessionCompanions.sessionId, args.sessionId),
        eq(sessionCompanions.worldNpcId, npc.id),
      ),
    )
    .limit(1);
  if (existing) return { ok: false, error: "already_summoned" };

  const level = Math.max(
    1,
    Math.min(COMPANION_MAX_LEVEL, npc.timesMet),
  );
  const maxHp = hpForLevel(level);
  await db.insert(sessionCompanions).values({
    sessionId: args.sessionId,
    worldNpcId: npc.id,
    slug: npc.slug,
    displayName: npc.name,
    level,
    currentHp: maxHp,
    maxHp,
    status: "alive",
    joinedAtTurn: args.turn,
  });
  return {
    ok: true,
    row: {
      worldNpcId: npc.id,
      slug: npc.slug,
      displayName: npc.name,
      level,
      currentHp: maxHp,
      maxHp,
      status: "alive",
      joinedAtTurn: args.turn,
    },
  };
}

export type DamageResult =
  | { ok: true; died: boolean; remainingHp: number }
  | { ok: false; error: "not_in_session" | "already_dead" };

/**
 * Apply damage to an alive in-run companion. On HP→0 the row's
 * status flips to 'dead' AND the world_npcs row's
 * last_seen_status also goes to 'dead' so the bond doesn't
 * resurrect them in future runs. Idempotent on dead → returns
 * already_dead without further effect.
 */
export async function damageCompanion(
  db: Db,
  args: {
    sessionId: string;
    worldNpcSlug: string;
    amount: number;
  },
): Promise<DamageResult> {
  if (args.amount <= 0) {
    return { ok: false, error: "not_in_session" };
  }
  const [row] = await db
    .select()
    .from(sessionCompanions)
    .where(
      and(
        eq(sessionCompanions.sessionId, args.sessionId),
        eq(sessionCompanions.slug, args.worldNpcSlug),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "not_in_session" };
  if (row.status !== "alive") return { ok: false, error: "already_dead" };

  const remainingHp = Math.max(0, row.currentHp - args.amount);
  const died = remainingHp === 0;
  await db
    .update(sessionCompanions)
    .set({
      currentHp: remainingHp,
      status: died ? "dead" : "alive",
      endedAt: died ? new Date() : null,
    })
    .where(
      and(
        eq(sessionCompanions.sessionId, args.sessionId),
        eq(sessionCompanions.worldNpcId, row.worldNpcId),
      ),
    );
  if (died) {
    await db
      .update(worldNpcs)
      .set({
        lastSeenStatus: "dead",
        updatedAt: new Date(),
      })
      .where(eq(worldNpcs.id, row.worldNpcId));
  }
  return { ok: true, died, remainingHp };
}

/**
 * Heal an alive in-run companion (capped at maxHp). Returns the
 * post-heal hp, or null if the companion isn't in the session
 * or is already dead.
 */
export async function healCompanion(
  db: Db,
  args: {
    sessionId: string;
    worldNpcSlug: string;
    amount: number;
  },
): Promise<number | null> {
  if (args.amount <= 0) return null;
  const [row] = await db
    .select()
    .from(sessionCompanions)
    .where(
      and(
        eq(sessionCompanions.sessionId, args.sessionId),
        eq(sessionCompanions.slug, args.worldNpcSlug),
      ),
    )
    .limit(1);
  if (!row || row.status !== "alive") return null;
  const newHp = Math.min(row.maxHp, row.currentHp + args.amount);
  await db
    .update(sessionCompanions)
    .set({ currentHp: newHp })
    .where(
      and(
        eq(sessionCompanions.sessionId, args.sessionId),
        eq(sessionCompanions.worldNpcId, row.worldNpcId),
      ),
    );
  return newHp;
}

/**
 * Read the current state of every companion in the session.
 * Used by /api/play/companions to power the in-game roster UI.
 */
export async function listInRunCompanions(
  db: Db,
  sessionId: string,
): Promise<CompanionRow[]> {
  const rows = await db
    .select()
    .from(sessionCompanions)
    .where(eq(sessionCompanions.sessionId, sessionId));
  return rows.map((r) => ({
    worldNpcId: r.worldNpcId,
    slug: r.slug,
    displayName: r.displayName,
    level: r.level,
    currentHp: r.currentHp,
    maxHp: r.maxHp,
    status: r.status as CompanionRow["status"],
    joinedAtTurn: r.joinedAtTurn,
  }));
}

/**
 * Level-up hook called from runTurn when session.ended fires
 * with reason='win'. Every alive companion gains +1 level
 * (capped at COMPANION_MAX_LEVEL); maxHp recomputes accordingly.
 * Currently-alive companions also heal to full at level-up so
 * the next run starts them whole.
 *
 * Returns the rows that leveled (for UI / event-emission).
 */
export async function levelUpAlive(
  db: Db,
  sessionId: string,
): Promise<Array<{ slug: string; level: number; maxHp: number }>> {
  const alive = await db
    .select()
    .from(sessionCompanions)
    .where(
      and(
        eq(sessionCompanions.sessionId, sessionId),
        eq(sessionCompanions.status, "alive"),
      ),
    );
  const leveled: Array<{ slug: string; level: number; maxHp: number }> = [];
  for (const r of alive) {
    if (r.level >= COMPANION_MAX_LEVEL) continue;
    const newLevel = r.level + 1;
    const newMax = hpForLevel(newLevel);
    await db
      .update(sessionCompanions)
      .set({
        level: newLevel,
        maxHp: newMax,
        currentHp: newMax,
      })
      .where(
        and(
          eq(sessionCompanions.sessionId, sessionId),
          eq(sessionCompanions.worldNpcId, r.worldNpcId),
        ),
      );
    leveled.push({ slug: r.slug, level: newLevel, maxHp: newMax });
  }
  return leveled;
}

void sql;
