/**
 * NPC duel stats — Phase 9 T5.5 follow-up.
 *
 * Reads content/npcs/<templateId>.json at lookup time and derives
 * the duel-relevant fields:
 *   - acceptance: probability the NPC accepts a challenge
 *     (0..1). Explicit `dueling.acceptance` wins; otherwise
 *     derived from stats.threat / stats.will / attitudeDefault.
 *   - modifier: flat +/- to the 2d6 roll. Explicit
 *     `dueling.modifier` wins; otherwise max(stats.will,
 *     stats.threat) - 1, clamped to [-2, +3].
 *   - flavor: optional trash-talk / refusal lines for the UI.
 *
 * NPCs without a template (e.g. dynamically-introduced) get a
 * sensible neutral default via DEFAULT_DUEL_STATS.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface NpcDuelStats {
  templateId: string;
  acceptance: number;
  modifier: number;
  faction: string | null;
  trashTalk: string[];
  refusalLine: string | null;
}

interface NpcTemplateJson {
  id: string;
  stats?: Record<string, number>;
  attitudeDefault?: number;
  metadata?: { faction?: string };
  dueling?: {
    acceptance?: number;
    modifier?: number;
    trashTalk?: string[];
    refusalLine?: string;
  };
}

const DEFAULT_DUEL_STATS: Omit<NpcDuelStats, "templateId" | "faction"> = {
  acceptance: 0.5,
  modifier: 0,
  trashTalk: [],
  refusalLine: null,
};

const cache = new Map<string, NpcDuelStats | null>();

function loadNpcTemplate(templateId: string): NpcTemplateJson | null {
  const path = join(
    process.cwd(),
    "content",
    "npcs",
    `${templateId}.json`,
  );
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as NpcTemplateJson;
  } catch {
    return null;
  }
}

/**
 * Pure (modulo file read): given a templateId, return the duel
 * stats. Caches for module lifetime; tests can clear via
 * _resetNpcDuelCacheForTests.
 */
export function getNpcDuelStats(templateId: string): NpcDuelStats {
  if (cache.has(templateId)) {
    const cached = cache.get(templateId);
    if (cached) return cached;
  }
  const tpl = loadNpcTemplate(templateId);
  if (!tpl) {
    const fallback: NpcDuelStats = {
      templateId,
      ...DEFAULT_DUEL_STATS,
      faction: null,
    };
    cache.set(templateId, fallback);
    return fallback;
  }
  const explicit = tpl.dueling ?? {};
  const stats = tpl.stats ?? {};
  const will = stats.will ?? 0;
  const threat = stats.threat ?? 0;
  const att = tpl.attitudeDefault ?? 0;
  // Derived acceptance: more threatening + more hostile NPCs are
  // likelier to accept. att=-3 (very hostile) gives ~0.85; att=+3
  // (warm) gives ~0.25. Threat shifts up.
  const derivedAcceptance = clamp(
    0.5 - att * 0.1 + threat * 0.05,
    0.05,
    0.95,
  );
  const derivedModifier = clamp(Math.max(will, threat) - 1, -2, 3);
  const result: NpcDuelStats = {
    templateId,
    acceptance:
      explicit.acceptance !== undefined
        ? clamp(explicit.acceptance, 0, 1)
        : derivedAcceptance,
    modifier:
      explicit.modifier !== undefined
        ? clamp(explicit.modifier, -2, 3)
        : derivedModifier,
    faction: tpl.metadata?.faction ?? null,
    trashTalk: explicit.trashTalk ?? [],
    refusalLine: explicit.refusalLine ?? null,
  };
  cache.set(templateId, result);
  return result;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Pure: given a stable seed and an acceptance probability,
 * decide accept vs refuse. Used by the challenge path so the
 * outcome is deterministic per challenge (replay-safe).
 */
export function rollAcceptance(args: {
  seed: number;
  acceptance: number;
}): boolean {
  // Mulberry32-derived but inlined to avoid a circular import
  // (rng.ts is small and stable).
  let s = args.seed >>> 0;
  s = (s + 0x6d2b79f5) >>> 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return r < args.acceptance;
}

/** Test/dev — clear the in-memory NPC duel-stats cache. */
export function _resetNpcDuelCacheForTests(): void {
  cache.clear();
}
