/**
 * GET /api/character — per-user lifetime stats.
 *
 * The "you, across all your reincarnations" page. Counts campaigns
 * by status, lifetime contribution count + delta to the meta-arc,
 * NPCs befriended (sum of timesHelped), lore entries the player
 * triggered, total turns played, total cost spent (Anthropic only),
 * favorite forms, etc.
 *
 * All queries scope to the requesting user. Anonymous users get 401.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { getEnergyView } from "@/lib/energy/state";
import { MAX_STREAK } from "@/lib/energy/streak";
import { turnsPerDay } from "@/lib/energy/tiers";
import {
  aiCalls,
  campaigns,
  metaContributions,
  users,
  worldLore,
  worldNpcs,
} from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { estimateCostUsd } from "@/lib/util/ai-telemetry";

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  if (!verified?.userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = verified.userId;

  // Campaigns by status.
  const campaignRows = await db
    .select({ status: campaigns.status, n: count() })
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .groupBy(campaigns.status);
  const campaignsByStatus: Record<string, number> = {};
  for (const r of campaignRows) campaignsByStatus[r.status] = r.n;
  const totalCampaigns = campaignRows.reduce((s, r) => s + r.n, 0);

  // Form distribution for this user.
  const formRows = await db
    .select({ formId: campaigns.formId, n: count() })
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .groupBy(campaigns.formId)
    .orderBy(desc(count()));

  // Meta-arc contributions.
  const [contribAgg] = await db
    .select({
      n: count(),
      totalDelta: sql<number>`COALESCE(SUM(${metaContributions.delta}), 0)::int`,
      feeds: sql<number>`COUNT(*) FILTER (WHERE ${metaContributions.delta} > 0)::int`,
      starves: sql<number>`COUNT(*) FILTER (WHERE ${metaContributions.delta} < 0)::int`,
    })
    .from(metaContributions)
    .where(eq(metaContributions.userId, userId));

  // World NPCs known.
  const [npcAgg] = await db
    .select({
      total: count(),
      timesHelped: sql<number>`COALESCE(SUM(${worldNpcs.timesHelped}), 0)::int`,
      timesHarmed: sql<number>`COALESCE(SUM(${worldNpcs.timesHarmed}), 0)::int`,
    })
    .from(worldNpcs)
    .where(eq(worldNpcs.userId, userId));

  // Top NPCs by interaction depth.
  const topNpcs = await db
    .select({
      slug: worldNpcs.slug,
      name: worldNpcs.name,
      relationshipScore: worldNpcs.relationshipScore,
      timesMet: worldNpcs.timesMet,
      timesHelped: worldNpcs.timesHelped,
      timesHarmed: worldNpcs.timesHarmed,
    })
    .from(worldNpcs)
    .where(eq(worldNpcs.userId, userId))
    .orderBy(desc(worldNpcs.timesMet), desc(worldNpcs.updatedAt))
    .limit(8);

  // Lore entries this user triggered.
  const [loreAgg] = await db
    .select({
      n: count(),
    })
    .from(worldLore)
    .where(eq(worldLore.sourceUserId, userId));
  const recentLore = await db
    .select()
    .from(worldLore)
    .where(eq(worldLore.sourceUserId, userId))
    .orderBy(desc(worldLore.createdAt))
    .limit(5);

  // AI cost lifetime.
  const aiRows = await db
    .select({
      model: aiCalls.model,
      inputTokens: aiCalls.inputTokens,
      outputTokens: aiCalls.outputTokens,
      cacheReadTokens: aiCalls.cacheReadTokens,
      cacheCreateTokens: aiCalls.cacheCreateTokens,
      callType: aiCalls.callType,
      success: aiCalls.success,
    })
    .from(aiCalls)
    .where(eq(aiCalls.userId, userId));
  let lifetimeCostUsd = 0;
  let lifetimeCalls = 0;
  let lifetimeTurnCalls = 0;
  let lifetimeInputTokens = 0;
  let lifetimeOutputTokens = 0;
  for (const r of aiRows) {
    if (r.success !== "true") continue;
    lifetimeCalls += 1;
    if (r.callType === "narrator") lifetimeTurnCalls += 1;
    lifetimeInputTokens += r.inputTokens + r.cacheReadTokens + r.cacheCreateTokens;
    lifetimeOutputTokens += r.outputTokens;
    lifetimeCostUsd += estimateCostUsd({
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreateTokens: r.cacheCreateTokens,
    });
  }

  const energy = await getEnergyView(db, { userId });

  // Legacy traits — cross-run scars and gifts. The pure listEarnedTraits
  // helper handles the catalog lookup + sort.
  const userRow = await db
    .select({
      legacyTraits: users.legacyTraits,
      pinnedTitle: users.pinnedTitle,
      coins: users.coins,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const traitCounts =
    (userRow[0]?.legacyTraits as Record<string, number> | undefined) ?? {};
  const { listEarnedTraits } = await import("@/lib/legacy/apply");
  const legacyTraits = listEarnedTraits(traitCounts);

  // Available titles — derived from the player's unlocked
  // achievements that have titleAwarded set. The character page
  // chooser uses this list; the title-set route validates against
  // the same predicate.
  const { listAchievements } = await import("@/lib/achievements/catalog");
  const { achievementsUnlocked } = await import("@/lib/db/schema");
  const unlocks = await db
    .select({ achievementId: achievementsUnlocked.achievementId })
    .from(achievementsUnlocked)
    .where(eq(achievementsUnlocked.userId, userId));
  const unlockedIds = new Set(unlocks.map((u) => u.achievementId));
  const availableTitles = listAchievements()
    .filter((a) => a.titleAwarded && unlockedIds.has(a.id))
    .map((a) => ({
      slug: a.titleAwarded as string,
      label: a.titleAwarded as string,
      sourceAchievement: a.id,
    }));
  const pinnedTitle = userRow[0]?.pinnedTitle ?? null;

  // Bonded companions — those who remember you (Phase 2 Day 7-8).
  const { isNotNull: _isNotNull, desc: _desc, and: _and } = await import("drizzle-orm");
  const companionRows = await db
    .select({
      id: worldNpcs.id,
      name: worldNpcs.name,
      slug: worldNpcs.slug,
      relationshipScore: worldNpcs.relationshipScore,
      bondedAt: worldNpcs.bondedAt,
      personalityCard: worldNpcs.personalityCard,
      lastSeenCampaignId: worldNpcs.lastSeenCampaignId,
    })
    .from(worldNpcs)
    .where(
      _and(eq(worldNpcs.userId, userId), _isNotNull(worldNpcs.bondedAt)),
    )
    .orderBy(_desc(worldNpcs.bondedAt))
    .limit(50);
  const companions = companionRows
    .filter((r) => r.bondedAt !== null)
    .map((r) => {
      const card = (r.personalityCard ?? {}) as {
        voice?: string;
        formMet?: string | null;
      };
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        relationshipScore: r.relationshipScore,
        bondedAtMs: r.bondedAt!.getTime(),
        formMet: card.formMet ?? null,
        personalityHint: card.voice ?? null,
        lastSeenInRun: r.lastSeenCampaignId ?? null,
      };
    });

  return NextResponse.json({
    totalCampaigns,
    campaignsByStatus,
    formDistribution: formRows,
    legacyTraits,
    availableTitles,
    pinnedTitle,
    coins: userRow[0]?.coins ?? 0,
    companions,
    energy: energy
      ? {
          energy: energy.energy,
          max: energy.tier.max,
          tierId: energy.tierId,
          effectiveTierId: energy.tier.id,
          tierLabel: energy.tier.label,
          turnsPerDay: turnsPerDay(energy.tier),
          blessing: energy.blessing
            ? {
                id: energy.blessing.id,
                label: energy.blessing.label,
                description: energy.blessing.description,
                expiresAtMs: energy.blessingExpiresAtMs,
              }
            : null,
          streak: {
            count: energy.streak.count,
            max: MAX_STREAK,
          },
        }
      : null,
    contributions: {
      total: contribAgg?.n ?? 0,
      totalDelta: contribAgg?.totalDelta ?? 0,
      feeds: contribAgg?.feeds ?? 0,
      starves: contribAgg?.starves ?? 0,
    },
    npcs: {
      total: npcAgg?.total ?? 0,
      timesHelped: npcAgg?.timesHelped ?? 0,
      timesHarmed: npcAgg?.timesHarmed ?? 0,
      top: topNpcs,
    },
    lore: {
      total: loreAgg?.n ?? 0,
      recent: recentLore.map((l) => ({
        id: l.id,
        summary: l.summary,
        category: l.category,
        salience: l.salience,
        createdAt: l.createdAt,
      })),
    },
    ai: {
      lifetimeCalls,
      lifetimeTurnCalls,
      lifetimeInputTokens,
      lifetimeOutputTokens,
      lifetimeCostUsd,
    },
  });
}

// Eq is unused above for some columns but kept for clarity.
void and;
