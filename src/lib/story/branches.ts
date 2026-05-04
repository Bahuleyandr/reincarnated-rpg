/**
 * Branch decisions — Phase 7 Day 44.
 *
 * Each branch is a fork in the world's story. At chapter-advance
 * time (when chapter_id ends), the resolver reads the configured
 * metric per path, picks the highest, writes the resolved_path,
 * and emits a `branch.resolved` world event so subsequent
 * chapter narrator fragments can reference the outcome.
 *
 * Metrics supported: `faction_<id>` (sum of faction_contributions
 * for the chapter window). More metric types can be added as the
 * year progresses.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  branchDecisions,
  type BranchDecision,
  worldEvents,
  worldLore,
} from "../db/schema";
import { invalidatePrefix } from "../util/cache";
import { log } from "../util/log";
import { uuidv7 } from "../util/uuidv7";

import { aggregatePerFaction } from "./factions";

export interface BranchPath {
  id: string;
  label: string;
  /** Metric driving the resolution. Currently supported:
   *  `faction_<id>` — chapter-window contribution sum. */
  metric: string;
}

export interface BranchContent {
  id: number;
  chapterId: number;
  question: string;
  paths: BranchPath[];
  defaultPath: string;
}

const cache = new Map<number, BranchContent | null>();

export function loadBranch(id: number): BranchContent | null {
  if (cache.has(id)) return cache.get(id) ?? null;
  const path = join(
    process.cwd(),
    "content",
    "story",
    "branches",
    `${id}.json`,
  );
  if (!existsSync(path)) {
    cache.set(id, null);
    return null;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as BranchContent & {
      _meta?: unknown;
    };
    cache.set(id, raw);
    return raw;
  } catch {
    cache.set(id, null);
    return null;
  }
}

/** For tests. */
export function clearBranchCache(): void {
  cache.clear();
}

/**
 * Pure: given path metric values, pick the winning path id. Ties
 * fall back to the branch's defaultPath.
 */
export function pickWinner(
  paths: BranchPath[],
  metrics: Record<string, number>,
  defaultPath: string,
): string {
  let maxValue = -Infinity;
  let winners: string[] = [];
  for (const p of paths) {
    const v = metrics[p.metric] ?? 0;
    if (v > maxValue) {
      maxValue = v;
      winners = [p.id];
    } else if (v === maxValue) {
      winners.push(p.id);
    }
  }
  if (winners.length === 1) return winners[0];
  return defaultPath;
}

/**
 * Resolve all branches whose chapter has just ended. Called from
 * the calendar advance job.
 */
export async function resolveBranchesForChapter(
  db: Db,
  resolvedChapterId: number,
): Promise<{ resolved: BranchDecision[] }> {
  // Look up branches with chapter_id = resolvedChapterId AND not
  // already resolved.
  const rows = await db
    .select()
    .from(branchDecisions)
    .where(eq(branchDecisions.chapterId, resolvedChapterId));
  const result: BranchDecision[] = [];
  for (const row of rows) {
    if (row.resolvedPath) continue;
    const content = loadBranch(row.id);
    if (!content) continue;
    // Build the metric map.
    const factionTotals = await aggregatePerFaction(db, resolvedChapterId);
    const metrics: Record<string, number> = {};
    for (const [fid, total] of Object.entries(factionTotals)) {
      metrics[`faction_${fid}`] = total;
    }
    const winner = pickWinner(content.paths, metrics, content.defaultPath);
    const winnerLabel =
      content.paths.find((p) => p.id === winner)?.label ?? winner;
    const resolvedAt = new Date();
    await db
      .update(branchDecisions)
      .set({
        resolvedPath: winner,
        resolvedAt,
        resolutionData: { metrics },
      })
      .where(eq(branchDecisions.id, row.id));
    await db.insert(worldEvents).values({
      id: uuidv7(),
      kind: "branch.resolved",
      payload: {
        branchId: row.id,
        chapterId: resolvedChapterId,
        winner,
        winnerLabel,
        question: row.question,
      },
    });
    await db.insert(worldLore).values({
      id: uuidv7(),
      summary: `Branch ${row.id} resolved: ${row.question} → ${winnerLabel}.`,
      prose: null,
      salience: 0.9,
      category: "branch_resolved",
      tags: ["branch_resolved", `branch-${row.id}`, `path-${winner}`],
    });
    invalidatePrefix("lore:");
    log.info("branch.resolved", {
      branchId: row.id,
      chapterId: resolvedChapterId,
      winner,
    });
    result.push({
      ...row,
      resolvedPath: winner,
      resolvedAt,
      resolutionData: { metrics },
    });
  }
  return { resolved: result };
}

/**
 * Sync the on-disk branch JSON into the DB. Invoked by the
 * calendar bootstrap so missing rows materialize without a
 * separate migration per branch.
 */
export async function ensureBranchesSeeded(db: Db): Promise<void> {
  for (let i = 1; i <= 10; i++) {
    const content = loadBranch(i);
    if (!content) continue;
    await db
      .insert(branchDecisions)
      .values({
        id: content.id,
        chapterId: content.chapterId,
        question: content.question,
        paths: content.paths,
      })
      .onConflictDoNothing({ target: branchDecisions.id });
  }
}

export async function listResolvedBranches(
  db: Db,
): Promise<BranchDecision[]> {
  const rows = await db.select().from(branchDecisions);
  return rows;
}
