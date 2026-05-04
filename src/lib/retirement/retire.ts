/**
 * Player-as-NPC retirement (Roadmap item 63).
 *
 * When a player ascends — and in the future, permadies — their
 * character template gets added to the recurring-NPC pool. Other
 * players' runs can then encounter them as faction-aligned
 * ambient figures whose persona is shaped by the retired player's
 * lifetime metrics and a one-line "last words" inscription.
 *
 * The recurring-NPC engine in lib/antagonist/recurring.ts walks
 * a file-based catalog at boot; this module exposes a parallel
 * DB-backed catalog and a merger so the engine sees both.
 */
import { desc, eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { retiredPlayers, users } from "../db/schema";
import type { RecurringNpcMeta } from "../antagonist/recurring";

export interface RetireInputs {
  userId: string;
  reason: "ascension" | "permadeath";
  /** Mirror of users.ascensionSeed shape (or analogous). */
  factionId: string | null;
  topSkillId: string | null;
  topSkillLevel: number;
  totalCampaigns: number;
  distinctForms: number;
  /** Free-text inscription, max 280 chars. The recurring NPC
   *  engine surfaces this when the retired player appears. */
  lastWords?: string | null;
  /** Override the player-facing name (defaults to username +
   *  "the ascended" / "the lost" suffix). */
  displayNameOverride?: string;
}

export type RetireResult =
  | { ok: true; templateId: string }
  | { ok: false; error: "already_retired" | "user_not_found" };

/**
 * Idempotent on the (userId) primary key. A second retirement
 * attempt returns already_retired without overwriting the row.
 */
export async function retirePlayer(
  db: Db,
  args: RetireInputs,
): Promise<RetireResult> {
  const [u] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  if (!u) return { ok: false, error: "user_not_found" };

  const [existing] = await db
    .select({ templateId: retiredPlayers.templateId })
    .from(retiredPlayers)
    .where(eq(retiredPlayers.userId, args.userId))
    .limit(1);
  if (existing) {
    return { ok: false, error: "already_retired" };
  }

  const templateId = `retired:${u.username}`;
  const suffix =
    args.reason === "ascension" ? "the ascended" : "the lost";
  const displayName = args.displayNameOverride ?? `${u.username}, ${suffix}`;
  const trimmedLastWords = args.lastWords
    ? args.lastWords.trim().slice(0, 280) || null
    : null;

  await db.insert(retiredPlayers).values({
    userId: args.userId,
    templateId,
    displayName,
    reason: args.reason,
    factionId: args.factionId ?? null,
    topSkillId: args.topSkillId ?? null,
    topSkillLevel: args.topSkillLevel,
    totalCampaigns: args.totalCampaigns,
    distinctForms: args.distinctForms,
    lastWords: trimmedLastWords,
  });
  return { ok: true, templateId };
}

/**
 * Pull the retired-player pool as RecurringNpcMeta-shaped rows
 * so the engine can merge them with the file catalog. The
 * topicsOfInterest list is derived from faction + top skill so
 * the model can ground prose in what the retired player cared
 * about most.
 */
export async function listRetiredAsRecurring(
  db: Db,
  opts: { limit?: number } = {},
): Promise<RecurringNpcMeta[]> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const rows = await db
    .select()
    .from(retiredPlayers)
    .orderBy(desc(retiredPlayers.retiredAt))
    .limit(limit);
  return rows.map((r) => {
    const topics = [
      r.factionId ? `faction:${r.factionId}` : null,
      r.topSkillId ? `skill:${r.topSkillId}` : null,
      r.reason,
    ].filter((s): s is string => s !== null);
    return {
      templateId: r.templateId,
      recurring: true,
      faction: r.factionId ?? undefined,
      voice: r.lastWords ?? undefined,
      topicsOfInterest: topics,
      appearanceProbability: {
        baseLow: r.baseLow,
        baseHigh: r.baseHigh,
        wyrmPhaseThreshold: r.wyrmThreshold,
        perPriorEncounterBonus: r.perPriorBonus,
        maxAppearanceProbability: r.maxAppear,
      },
    } satisfies RecurringNpcMeta;
  });
}

/**
 * Compose the persona fragment the narrator sees when a retired
 * player is introduced. Pure — keeps the recurring-NPC engine
 * unchanged; the engine just calls this and stamps it into the
 * NPC introduction prompt.
 */
export function composeRetiredPersona(args: {
  displayName: string;
  reason: string;
  factionId: string | null;
  topSkillId: string | null;
  topSkillLevel: number;
  totalCampaigns: number;
  distinctForms: number;
  lastWords: string | null;
}): string {
  const livedTag =
    args.totalCampaigns >= 50
      ? "lived many lives"
      : args.totalCampaigns >= 20
        ? "lived several lives"
        : "lived briefly";
  const factionTag = args.factionId ? ` of ${args.factionId}` : "";
  const skillTag = args.topSkillId
    ? `, last skilled in ${args.topSkillId} (lv ${args.topSkillLevel})`
    : "";
  const reasonTag =
    args.reason === "ascension" ? "ascended out of the cycle" : "lost to it";
  const ww = args.lastWords ? `\nLast words: "${args.lastWords}"` : "";
  return `${args.displayName}${factionTag} — ${livedTag} (${args.distinctForms} forms, ${args.totalCampaigns} runs)${skillTag}; ${reasonTag}.${ww}`;
}

/**
 * Wired version — looks up a retired_players row by templateId
 * and composes the persona fragment. Returns null when the
 * templateId isn't a retired player (file-based recurring NPCs
 * use this and get null, falling through to their own voice
 * field). The recurring-NPC engine should call this when an
 * NPC is introduced; the resulting fragment slots into the
 * narrator's user message as a single line of NPC context.
 */
export async function composeRetiredPersonaById(
  db: Db,
  templateId: string,
): Promise<string | null> {
  if (!templateId.startsWith("retired:")) return null;
  const [row] = await db
    .select()
    .from(retiredPlayers)
    .where(eq(retiredPlayers.templateId, templateId))
    .limit(1);
  if (!row) return null;
  return composeRetiredPersona({
    displayName: row.displayName,
    reason: row.reason,
    factionId: row.factionId,
    topSkillId: row.topSkillId,
    topSkillLevel: row.topSkillLevel,
    totalCampaigns: row.totalCampaigns,
    distinctForms: row.distinctForms,
    lastWords: row.lastWords,
  });
}
