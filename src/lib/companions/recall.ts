/**
 * Companion recall — at turn 1 of a new campaign for a logged-in
 * user, fetch up to 2 of their bonded companions and project them
 * as `Memory` entries that the existing memory-retrieval pipeline
 * can fold into the narrator's prompt.
 *
 * Ordering: most recent interaction first (highest
 * `lastSeenCampaignId` proxy via createdAt). Two is a soft cap;
 * more would crowd turn 1's already-busy context.
 *
 * The narrator chooses whether to weave them in. The recall layer
 * just makes them available.
 */
import { desc, eq, isNotNull } from "drizzle-orm";

import type { Db } from "../db/client";
import { worldNpcs } from "../db/schema";
import type { Memory } from "../game/types";
import type { PersonalityCard } from "./bond";

/**
 * Return up to `limit` companion-memory entries for the user. Each
 * Memory's text is a 1-line history beat ("you remember Kethra,
 * the scholar you saved as a slime — she walks carefully now, as
 * if expecting you again"). Empty array for users with no bonded
 * companions or for anon sessions.
 */
export async function recallCompanions(
  db: Db,
  userId: string | null,
  limit = 2,
): Promise<Memory[]> {
  if (!userId) return [];

  const rows = await db
    .select({
      id: worldNpcs.id,
      name: worldNpcs.name,
      slug: worldNpcs.slug,
      bondedAt: worldNpcs.bondedAt,
      personalityCard: worldNpcs.personalityCard,
      timesHelped: worldNpcs.timesHelped,
      timesHarmed: worldNpcs.timesHarmed,
    })
    .from(worldNpcs)
    .where(
      isNotNull(worldNpcs.bondedAt),
    )
    .orderBy(desc(worldNpcs.bondedAt))
    .limit(limit * 4); // overfetch then filter for this user

  const filtered = await db
    .select({
      id: worldNpcs.id,
      name: worldNpcs.name,
      slug: worldNpcs.slug,
      bondedAt: worldNpcs.bondedAt,
      personalityCard: worldNpcs.personalityCard,
      timesHelped: worldNpcs.timesHelped,
      timesHarmed: worldNpcs.timesHarmed,
    })
    .from(worldNpcs)
    .where(
      eq(worldNpcs.userId, userId),
    )
    .orderBy(desc(worldNpcs.bondedAt))
    .limit(limit);

  void rows;
  const bonded = filtered.filter((r) => r.bondedAt !== null);
  return bonded.map((r) => {
    const card = (r.personalityCard ?? {}) as Partial<PersonalityCard>;
    const formMetClause = card.formMet
      ? ` — they remember you as ${card.formMet}`
      : "";
    const moodClause = card.voice
      ? ` ${card.voice}`
      : ` ${r.name} remembers your soul.`;
    return {
      id: `companion:${r.id}`,
      summary: `you remember ${r.name}${formMetClause}.${moodClause}`,
      salience: 0.9,
      eventSeqRange: [0, 0],
    } as Memory;
  });
}

/**
 * Convenience: only at turn 1. Callers can gate on this so they
 * don't double-recall on every turn.
 */
export function shouldRecallCompanions(turn: number): boolean {
  return turn === 0 || turn === 1;
}
