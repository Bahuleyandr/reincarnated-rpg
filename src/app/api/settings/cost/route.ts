/**
 * GET /api/settings/cost — per-user cost rollup from ai_calls.
 *
 * Returns three windows (last 24h, last 7 days, last 30 days) plus a
 * per-model breakdown for the active window. Cost is estimated for
 * Anthropic models from MODEL_RATES; for everything else we report
 * tokens only — pricing is a moving target across providers and we
 * shouldn't lie about it.
 *
 * Auth: cookie userId required.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { aiCalls } from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { estimateCostUsd } from "@/lib/util/ai-telemetry";

interface Bucket {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  estCostUsd: number;
}

function emptyBucket(): Bucket {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
    estCostUsd: 0,
  };
}

export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const verified = await verifyCookie(cookie);
  const userId = verified?.userId;
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      model: aiCalls.model,
      inputTokens: aiCalls.inputTokens,
      outputTokens: aiCalls.outputTokens,
      cacheReadTokens: aiCalls.cacheReadTokens,
      cacheCreateTokens: aiCalls.cacheCreateTokens,
      createdAt: aiCalls.createdAt,
      success: aiCalls.success,
    })
    .from(aiCalls)
    .where(and(eq(aiCalls.userId, userId), gte(aiCalls.createdAt, since30)));

  const last24 = emptyBucket();
  const last7 = emptyBucket();
  const last30 = emptyBucket();
  const byModel = new Map<string, Bucket>();

  const cutoff24 = now - 24 * 60 * 60 * 1000;
  const cutoff7 = now - 7 * 24 * 60 * 60 * 1000;

  for (const r of rows) {
    if (r.success === "false") continue;
    const ts = r.createdAt instanceof Date ? r.createdAt.getTime() : 0;
    const usd = estimateCostUsd({
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheCreateTokens: r.cacheCreateTokens,
    });
    const apply = (b: Bucket) => {
      b.calls += 1;
      b.inputTokens += r.inputTokens;
      b.outputTokens += r.outputTokens;
      b.cacheReadTokens += r.cacheReadTokens;
      b.cacheCreateTokens += r.cacheCreateTokens;
      b.estCostUsd += usd;
    };
    apply(last30);
    if (ts >= cutoff7) apply(last7);
    if (ts >= cutoff24) apply(last24);
    if (!byModel.has(r.model)) byModel.set(r.model, emptyBucket());
    apply(byModel.get(r.model)!);
  }

  // Total turn count over 30d (a useful denominator).
  const turnRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.userId, userId),
        eq(aiCalls.callType, "narrator"),
        gte(aiCalls.createdAt, since30),
      ),
    );

  return NextResponse.json({
    last24h: last24,
    last7d: last7,
    last30d: last30,
    turns30d: turnRows[0]?.n ?? 0,
    byModel: Array.from(byModel.entries())
      .map(([model, b]) => ({ model, ...b }))
      .sort((a, b) => b.estCostUsd - a.estCostUsd || b.calls - a.calls),
  });
}
