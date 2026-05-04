/**
 * Companion bond logic. When the player's relationship score with a
 * world NPC crosses +3, that NPC gets promoted to a "companion" —
 * marked with `bondedAt` and given a `personalityCard` that future
 * runs can reference.
 *
 * Two layers:
 *   - `shouldBond(score)` — pure threshold check. No DB calls.
 *   - `materializeBond(db, ...)` — atomic UPDATE that sets bondedAt
 *     + writes a personality card (template-generated for v1; the
 *     Haiku-driven generator can be wired later as an opt-in
 *     enhancement).
 *
 * Idempotent: bonding twice is a no-op because `bondedAt IS NULL`
 * is part of the WHERE clause.
 *
 * Personality card v1: deterministic templating from the NPC's
 * accumulated data (slug, name, helped/harmed counts, last seen
 * status). No LLM call by default — we want the bond to fire
 * synchronously without burning Anthropic spend per relationship
 * tick. A future iteration can add an opt-in
 * `generatePersonalityCardLLM` path.
 */
import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "../db/client";
import { worldNpcs } from "../db/schema";
import { log } from "../util/log";

export const BOND_THRESHOLD = 3;

export interface PersonalityCard {
  /** Short voice/manner descriptor — used in narrator prompt. */
  voice: string;
  /** 2-3 short mannerism phrases. */
  mannerisms: string[];
  /** Topics this NPC steers conversations toward. */
  topicsOfInterest: string[];
  /** Form the player was when they first crossed the bond
   *  threshold. Useful flavor: "they remember you as a slime." */
  formMet: string | null;
}

export function shouldBond(relationshipScore: number): boolean {
  return relationshipScore >= BOND_THRESHOLD;
}

interface BondInputs {
  npcId: string;
  npcName: string;
  slug: string;
  formMet: string | null;
  timesHelped: number;
  timesHarmed: number;
  memorySummary: string | null;
}

/**
 * Pure: build a deterministic personality card from the NPC's
 * accumulated facts. Same inputs always produce the same card so
 * tests can pin behavior without mocking an LLM.
 */
export function buildPersonalityCard(inputs: BondInputs): PersonalityCard {
  const { npcName, timesHelped, timesHarmed, formMet, memorySummary } = inputs;

  // Voice: lean on the helped/harmed ratio for tone.
  let voice: string;
  if (timesHelped > timesHarmed * 2) {
    voice = `${npcName} speaks warmly, with the cadence of someone who owes you something quiet.`;
  } else if (timesHarmed > timesHelped) {
    voice = `${npcName} speaks carefully, like someone who knows what you can do.`;
  } else {
    voice = `${npcName} speaks evenly — neither gratitude nor grudge, just recognition.`;
  }

  // Mannerisms: 2-3 short phrases anchored on slug + counts.
  const mannerisms: string[] = [];
  if (timesHelped > 0) {
    mannerisms.push(`looks at you the way someone looks at a debt they owe`);
  }
  if (timesHarmed > 0) {
    mannerisms.push(`keeps a hand near where a knife would be, even unarmed`);
  }
  if (formMet) {
    mannerisms.push(`talks past your current shape, addressing the soul beneath`);
  }
  // Always include at least one anchor — slug-derived if no other.
  if (mannerisms.length === 0) {
    mannerisms.push(`speaks of you in the third person sometimes, then catches themselves`);
  }

  // Topics: pulled from memorySummary if it has clean noun phrases;
  // otherwise sensible defaults.
  const topicsOfInterest: string[] = [];
  if (memorySummary) {
    // Cheap extraction: pick the first 2 capitalized nouns from the
    // summary. Doesn't need to be perfect.
    const matches = memorySummary.match(/\b[A-Z][a-z]+\b/g) ?? [];
    for (const m of matches.slice(0, 2)) topicsOfInterest.push(m);
  }
  if (topicsOfInterest.length === 0) {
    topicsOfInterest.push("what you were last", "what brought you here");
  }

  return {
    voice,
    mannerisms,
    topicsOfInterest,
    formMet,
  };
}

/**
 * Atomically promote an NPC to companion status. No-op if already
 * bonded (or if relationshipScore dropped below threshold by the
 * time we get here).
 */
export async function materializeBond(
  db: Db,
  npc: BondInputs,
  now: Date = new Date(),
): Promise<{ bonded: boolean; card: PersonalityCard | null }> {
  const card = buildPersonalityCard(npc);
  try {
    const rows = await db
      .update(worldNpcs)
      .set({
        bondedAt: now,
        personalityCard: card as never,
        updatedAt: now,
      })
      .where(
        and(
          eq(worldNpcs.id, npc.npcId),
          isNull(worldNpcs.bondedAt),
        ),
      )
      .returning({ id: worldNpcs.id });
    if (rows.length > 0) {
      log.info("companions.bonded", {
        npcId: npc.npcId,
        slug: npc.slug,
        formMet: npc.formMet,
      });
      return { bonded: true, card };
    }
    return { bonded: false, card: null };
  } catch (err) {
    log.warn("companions.bond_failed", {
      npcId: npc.npcId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { bonded: false, card: null };
  }
}
