/**
 * Trainer catalog reader — Phase 5 Day 23-24.
 *
 * NPC trainer data lives in `content/npcs/<id>.json` under
 * `metadata.teachesSkill` (skill id) and `metadata.teachingFee`
 * (coin cost). The `learn_skill_from` tool reads this via
 * `getTrainerForNpc(templateId)` to validate.
 *
 * Caches per-template; clear with `clearTrainerCache()` for tests.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TrainerInfo {
  templateId: string;
  teachesSkill: string;
  teachingFee: number;
  teachingLines: string[];
}

interface RawNpc {
  id?: unknown;
  metadata?: {
    teachesSkill?: unknown;
    teachingFee?: unknown;
    teachingLines?: unknown;
  };
}

const trainerCache = new Map<string, TrainerInfo | null>();

export function getTrainerForNpc(templateId: string): TrainerInfo | null {
  if (trainerCache.has(templateId)) return trainerCache.get(templateId)!;
  const path = join(process.cwd(), "content", "npcs", `${templateId}.json`);
  if (!existsSync(path)) {
    trainerCache.set(templateId, null);
    return null;
  }
  let parsed: RawNpc;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as RawNpc;
  } catch {
    trainerCache.set(templateId, null);
    return null;
  }
  const meta = parsed.metadata;
  if (
    !meta ||
    typeof meta.teachesSkill !== "string" ||
    typeof meta.teachingFee !== "number" ||
    meta.teachingFee < 0
  ) {
    trainerCache.set(templateId, null);
    return null;
  }
  const lines = Array.isArray(meta.teachingLines)
    ? (meta.teachingLines as unknown[]).filter(
        (l): l is string => typeof l === "string",
      )
    : [];
  const info: TrainerInfo = {
    templateId,
    teachesSkill: meta.teachesSkill,
    teachingFee: Math.floor(meta.teachingFee),
    teachingLines: lines,
  };
  trainerCache.set(templateId, info);
  return info;
}

export function clearTrainerCache(): void {
  trainerCache.clear();
}
