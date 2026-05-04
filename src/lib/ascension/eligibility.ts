/**
 * Ascension eligibility — post-Phase-8 follow-up.
 *
 * A player can ascend after meeting all of:
 *   - tutorial_completed = true
 *   - >= ASCENSION_RUN_THRESHOLD total campaigns
 *   - >= ASCENSION_VARIETY_THRESHOLD distinct forms played
 *   - has pledged a faction (any)
 *
 * On ascend: a meta-form id is assigned based on dominant
 * faction + top skill; users.ascension_seed captures lifetime
 * metrics. From that point forward, the reincarnation picker
 * forces the ascension form (no other choices).
 */
import { count, countDistinct, eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import { campaigns, users, userSkills } from "../db/schema";

export const ASCENSION_RUN_THRESHOLD = 50;
export const ASCENSION_VARIETY_THRESHOLD = 4;

export interface EligibilityState {
  eligible: boolean;
  alreadyAscended: boolean;
  totalCampaigns: number;
  distinctForms: number;
  hasFaction: boolean;
  tutorialCompleted: boolean;
  /** Threshold deltas the user still has to clear (positive
   *  numbers when below threshold). */
  campaignsNeeded: number;
  varietyNeeded: number;
}

export async function checkEligibility(
  db: Db,
  userId: string,
): Promise<EligibilityState> {
  const [u] = await db
    .select({
      ascendedAt: users.ascendedAt,
      tutorialCompleted: users.tutorialCompleted,
      factionId: users.factionId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) {
    return {
      eligible: false,
      alreadyAscended: false,
      totalCampaigns: 0,
      distinctForms: 0,
      hasFaction: false,
      tutorialCompleted: false,
      campaignsNeeded: ASCENSION_RUN_THRESHOLD,
      varietyNeeded: ASCENSION_VARIETY_THRESHOLD,
    };
  }
  if (u.ascendedAt) {
    return {
      eligible: false,
      alreadyAscended: true,
      totalCampaigns: 0,
      distinctForms: 0,
      hasFaction: !!u.factionId,
      tutorialCompleted: u.tutorialCompleted,
      campaignsNeeded: 0,
      varietyNeeded: 0,
    };
  }
  const [agg] = await db
    .select({
      total: count(),
      distinctForms: countDistinct(campaigns.formId),
    })
    .from(campaigns)
    .where(eq(campaigns.userId, userId));
  const totalCampaigns = agg?.total ?? 0;
  const distinctForms = agg?.distinctForms ?? 0;
  const hasFaction = !!u.factionId;
  const tutorialCompleted = u.tutorialCompleted;
  const eligible =
    tutorialCompleted &&
    hasFaction &&
    totalCampaigns >= ASCENSION_RUN_THRESHOLD &&
    distinctForms >= ASCENSION_VARIETY_THRESHOLD;
  return {
    eligible,
    alreadyAscended: false,
    totalCampaigns,
    distinctForms,
    hasFaction,
    tutorialCompleted,
    campaignsNeeded: Math.max(0, ASCENSION_RUN_THRESHOLD - totalCampaigns),
    varietyNeeded: Math.max(0, ASCENSION_VARIETY_THRESHOLD - distinctForms),
  };
}

/**
 * Pure: pick the ascension meta-form id from the player's
 * dominant faction + top skill. The mapping is data-driven so
 * future authors can extend without code changes.
 */
const ASCENSION_FORMS: Record<string, Record<string, string>> = {
  choristers: {
    alchemy: "cantor-of-the-long-song",
    farming: "garden-keeper-of-the-spire",
    cooking: "salt-keeper",
    default: "chorister-ascendant",
  },
  rust_hand: {
    smithing: "iron-hand-ascended",
    smelting: "furnace-warden",
    mining: "deep-mark",
    default: "rust-hand-ascendant",
  },
  idle: {
    default: "the-still-one",
  },
  forsaken: {
    default: "forsaken-revenant",
  },
};

export function pickAscensionForm(args: {
  factionId: string;
  topSkillId: string | null;
}): string {
  const factionMap =
    ASCENSION_FORMS[args.factionId] ?? ASCENSION_FORMS.idle;
  if (args.topSkillId && factionMap[args.topSkillId]) {
    return factionMap[args.topSkillId];
  }
  return factionMap.default ?? "the-still-one";
}

export interface AscendInputs {
  userId: string;
}

export interface AscendResult {
  ok: boolean;
  ascensionFormId?: string;
  error?: string;
}

export async function ascend(
  db: Db,
  args: AscendInputs,
): Promise<AscendResult> {
  const eligibility = await checkEligibility(db, args.userId);
  if (eligibility.alreadyAscended) {
    return { ok: false, error: "already_ascended" };
  }
  if (!eligibility.eligible) {
    return { ok: false, error: "not_eligible" };
  }
  const [u] = await db
    .select({ factionId: users.factionId })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  // Top skill = highest level.
  const skills = await db
    .select({
      skillId: userSkills.skillId,
      level: userSkills.level,
    })
    .from(userSkills)
    .where(eq(userSkills.userId, args.userId))
    .orderBy(sql`level DESC`)
    .limit(1);
  const topSkillId = skills[0]?.skillId ?? null;
  const factionId = u?.factionId ?? "idle";
  const ascensionFormId = pickAscensionForm({ factionId, topSkillId });
  const seed = {
    totalCampaigns: eligibility.totalCampaigns,
    distinctForms: eligibility.distinctForms,
    factionId,
    topSkillId,
    topSkillLevel: skills[0]?.level ?? 0,
    ascendedAtMs: Date.now(),
  };
  await db
    .update(users)
    .set({
      ascendedAt: new Date(),
      ascensionFormId,
      ascensionSeed: seed,
      updatedAt: new Date(),
    })
    .where(eq(users.id, args.userId));

  // Roadmap 63: ascended players retire into the recurring-NPC
  // pool so other players' future runs may encounter them. Best-
  // effort — a retire failure shouldn't block the ascension
  // itself (the user's row is already updated above).
  try {
    const { retirePlayer } = await import("../retirement/retire");
    await retirePlayer(db, {
      userId: args.userId,
      reason: "ascension",
      factionId,
      topSkillId,
      topSkillLevel: skills[0]?.level ?? 0,
      totalCampaigns: eligibility.totalCampaigns,
      distinctForms: eligibility.distinctForms,
      // The ascend API doesn't accept last-words yet; UI-side
      // input will pass it through later. For now retired
      // players appear without an inscription.
      lastWords: null,
    });
  } catch {
    // ignore — retirement is non-blocking
  }

  return { ok: true, ascensionFormId };
}
