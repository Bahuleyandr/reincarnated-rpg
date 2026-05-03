/**
 * GET /api/leaderboard
 *
 * Live leaderboard built from the ai_calls telemetry table. Ranks
 * (preset, model) pairs across ALL users by:
 *   - calls: how many turns this combination has actually run
 *   - avgLatencyMs: median surrogate via integer mean
 *   - successRate: 1 - error_rate
 *   - avgCostUsd: per-call (Anthropic only — others report tokens)
 *
 * Public — anyone can see what models are working out for the game.
 * No PII; we aggregate by (preset, model, callType) only.
 *
 * Filter:
 *   - ?days=N  (default 30)
 *   - ?callType=narrator | classifier | tone_judge (default: narrator)
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { aiCalls } from "@/lib/db/schema";
import { estimateCostUsd } from "@/lib/util/ai-telemetry";

interface Row {
  presetId: string | null;
  model: string;
  calls: number;
  successCalls: number;
  errCalls: number;
  totalLatencyMs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.max(
    1,
    Math.min(365, Number(url.searchParams.get("days") ?? "30")),
  );
  const callType = url.searchParams.get("callType") ?? "narrator";
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      presetId: aiCalls.presetId,
      model: aiCalls.model,
      success: aiCalls.success,
      durationMs: aiCalls.durationMs,
      inputTokens: aiCalls.inputTokens,
      outputTokens: aiCalls.outputTokens,
      cacheReadTokens: aiCalls.cacheReadTokens,
      cacheCreateTokens: aiCalls.cacheCreateTokens,
    })
    .from(aiCalls)
    .where(
      and(eq(aiCalls.callType, callType), gte(aiCalls.createdAt, since)),
    );

  const buckets = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.presetId ?? "env-default"}::${r.model}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        presetId: r.presetId,
        model: r.model,
        calls: 0,
        successCalls: 0,
        errCalls: 0,
        totalLatencyMs: 0,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      };
      buckets.set(key, b);
    }
    b.calls += 1;
    if (r.success === "true") b.successCalls += 1;
    else b.errCalls += 1;
    b.totalLatencyMs += r.durationMs;
    b.totalInputTokens += r.inputTokens;
    b.totalOutputTokens += r.outputTokens;
    b.totalCostUsd += estimateCostUsd({
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreateTokens: r.cacheCreateTokens,
    });
  }

  const board = Array.from(buckets.values())
    .filter((b) => b.calls >= 3) // tiny samples are noise
    .map((b) => ({
      presetId: b.presetId,
      model: b.model,
      calls: b.calls,
      avgLatencyMs: Math.round(b.totalLatencyMs / b.calls),
      successRate: b.calls > 0 ? b.successCalls / b.calls : 0,
      avgCostUsd: b.totalCostUsd / b.calls,
      avgInputTokens: Math.round(b.totalInputTokens / b.calls),
      avgOutputTokens: Math.round(b.totalOutputTokens / b.calls),
    }))
    .sort((a, b) => {
      // Composite rank: success first, then speed, then cost.
      const sd = b.successRate - a.successRate;
      if (Math.abs(sd) > 0.01) return sd;
      return a.avgLatencyMs - b.avgLatencyMs;
    });

  // Total aggregates for context.
  const [totals] = await db
    .select({
      n: sql<number>`count(*)::int`,
      models: sql<number>`count(distinct ${aiCalls.model})::int`,
    })
    .from(aiCalls)
    .where(
      and(eq(aiCalls.callType, callType), gte(aiCalls.createdAt, since)),
    );

  return NextResponse.json({
    days,
    callType,
    totalCalls: totals?.n ?? 0,
    distinctModels: totals?.models ?? 0,
    leaderboard: board,
  });
}
