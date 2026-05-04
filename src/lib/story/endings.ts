/**
 * Year-end ending resolver — Phase 7 Day 50.
 *
 * Six endings per docs/STORY_BIBLE.md. The resolver runs at the
 * year-rollover (chapter 49 → year+1) and picks one ending based
 * on a deterministic precedence over the year's resolved branches,
 * vote outcomes, faction totals, and Wyrm raid HP. Writes a
 * year_endings row + a Year-2 seed packet for the next year's
 * bootstrap.
 *
 * Endings (subset, deterministic):
 *   - "the_song_carries"   — Choristers dominant + Vote 1 = "open the song"
 *   - "the_iron_holds"     — Rust Hand dominant + Wyrm hp <= 0 (raid felled it)
 *   - "the_silence_kept"   — Idle dominant across the year
 *   - "the_forsaken_named" — Branch IV unlocked Forsaken faction
 *   - "the_three_voted"    — Three votes all resolved, no faction dominant
 *   - "the_quiet_year"     — fallback / no clear signal
 */
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  branchDecisions,
  factions,
  metaArcs,
  worldEvents,
  worldLore,
  worldVotes,
  yearEndings,
} from "../db/schema";
import { invalidatePrefix } from "../util/cache";
import { log } from "../util/log";
import { uuidv7 } from "../util/uuidv7";

export interface EndingResult {
  endingId: string;
  endingLabel: string;
  resolutionData: Record<string, unknown>;
  nextYearSeed: Record<string, unknown>;
}

const ENDINGS = {
  the_song_carries: "The Song Carries",
  the_iron_holds: "The Iron Holds",
  the_silence_kept: "The Silence Kept",
  the_forsaken_named: "The Forsaken Named",
  the_three_voted: "The Three Voted",
  the_quiet_year: "The Quiet Year",
} as const;

type EndingId = keyof typeof ENDINGS;

export async function resolveYearEnding(
  db: Db,
  year: number,
): Promise<EndingResult> {
  // Already resolved? Return it.
  const [existing] = await db
    .select()
    .from(yearEndings)
    .where(eq(yearEndings.year, year))
    .limit(1);
  if (existing) {
    return {
      endingId: existing.endingId,
      endingLabel: existing.endingLabel,
      resolutionData: existing.resolutionData as Record<string, unknown>,
      nextYearSeed: existing.nextYearSeed as Record<string, unknown>,
    };
  }

  // Gather metrics.
  const factionRows = await db.select().from(factions);
  const factionsByContribution = [...factionRows].sort(
    (a, b) => b.cumulativeContribution - a.cumulativeContribution,
  );
  const dominant = factionsByContribution[0];
  const second = factionsByContribution[1];
  const dominantMargin =
    (dominant?.cumulativeContribution ?? 0) -
    (second?.cumulativeContribution ?? 0);
  const factionDominant =
    dominant && dominantMargin > 50 ? dominant.id : null;

  const branches = await db.select().from(branchDecisions);
  const resolvedBranches = branches.filter((b) => b.resolvedPath !== null);
  const branchOutcomes = Object.fromEntries(
    resolvedBranches.map((b) => [b.id, b.resolvedPath]),
  );

  const votes = await db.select().from(worldVotes);
  const resolvedVotes = votes.filter((v) => v.resolvedAt !== null);
  const voteOutcomes = Object.fromEntries(
    resolvedVotes.map((v) => [v.id, v.winningOption]),
  );

  const [arcRow] = await db
    .select({ hp: metaArcs.hp })
    .from(metaArcs)
    .where(eq(metaArcs.id, "long-wyrm"))
    .limit(1);
  const wyrmHp = arcRow?.hp ?? 1000;
  const wyrmFelled = wyrmHp <= 0;
  const branchIvForsaken =
    branchOutcomes[4] === "forsaken_unlocked" ||
    factionRows.some((f) => f.id === "forsaken" && f.active);

  let pick: EndingId = "the_quiet_year";
  if (
    factionDominant === "choristers" &&
    voteOutcomes[1] === "open_the_song"
  ) {
    pick = "the_song_carries";
  } else if (factionDominant === "rust_hand" && wyrmFelled) {
    pick = "the_iron_holds";
  } else if (factionDominant === "idle") {
    pick = "the_silence_kept";
  } else if (branchIvForsaken) {
    pick = "the_forsaken_named";
  } else if (resolvedVotes.length >= 3 && !factionDominant) {
    pick = "the_three_voted";
  }

  const resolutionData = {
    factionsByContribution: factionsByContribution.map((f) => ({
      id: f.id,
      total: f.cumulativeContribution,
    })),
    branchOutcomes,
    voteOutcomes,
    wyrmHp,
    wyrmFelled,
    factionDominant,
  };

  // Year-2 seed: pass the dominant faction's bonuses + resolved
  // branches forward as initial conditions.
  const nextYearSeed = {
    inheritedDominantFaction: factionDominant,
    inheritedBranches: branchOutcomes,
    inheritedVotes: voteOutcomes,
  };

  await db.insert(yearEndings).values({
    year,
    endingId: pick,
    endingLabel: ENDINGS[pick],
    resolutionData,
    nextYearSeed,
  });

  await db.insert(worldEvents).values({
    id: uuidv7(),
    kind: "year.ended",
    payload: {
      year,
      endingId: pick,
      endingLabel: ENDINGS[pick],
    },
  });

  await db.insert(worldLore).values({
    id: uuidv7(),
    summary: `Year ${year} ended: ${ENDINGS[pick]}.`,
    prose: null,
    salience: 0.95,
    category: "year_ending",
    tags: ["year_ending", `year-${year}`, pick],
  });
  invalidatePrefix("lore:");

  log.info("year.ending.resolved", { year, endingId: pick });

  return {
    endingId: pick,
    endingLabel: ENDINGS[pick],
    resolutionData,
    nextYearSeed,
  };
}

void sql;
