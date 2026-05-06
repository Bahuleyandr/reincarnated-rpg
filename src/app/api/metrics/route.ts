/**
 * /api/metrics — operational snapshot. POLISH_PLAN 0b.3.
 *
 * JSON body of:
 *   - process       — uptime, memory, node version
 *   - sentry        — { configured: boolean }
 *   - aiCalls       — counts, sum cost, mean latency over last 24h,
 *                     bucketed by callType
 *   - sessions      — active sessions in the last 1h, total
 *                     turns in the last 24h
 *   - errors        — tool_validation_failed count in last 1h
 *
 * Not Prometheus format — JSON is enough at current scale and is
 * easier to read raw. If we adopt a metrics scraper (Grafana
 * Cloud, Datadog) we'll layer a Prometheus exporter on top.
 *
 * Public read-only — exposes no PII, no credentials, no
 * per-session content. Same auth posture as /api/health and
 * /api/ready.
 */
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { isSentryConfigured } from "@/lib/observability/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Cost rates per million tokens (mirrored from
// lib/util/ai-telemetry.ts so the metrics endpoint can compute
// dollar cost without re-importing the pricing table — kept tiny
// and explicit on purpose). When a model isn't listed, we treat
// it as zero-cost (template / openai-compatible / unknown
// provider) and surface the call count without a dollar
// estimate.

const RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

interface AiCallBucket {
  callType: string;
  count: number;
  errorCount: number;
  sumInputTokens: number;
  sumOutputTokens: number;
  sumCostUsd: number;
  meanDurationMs: number;
}

async function aiCallStats(): Promise<AiCallBucket[]> {
  const rows = (await db.execute(sql`
    SELECT
      call_type,
      model,
      COUNT(*)::int AS count,
      SUM(CASE WHEN success = 'false' THEN 1 ELSE 0 END)::int AS error_count,
      COALESCE(SUM(input_tokens), 0)::bigint AS sum_input,
      COALESCE(SUM(output_tokens), 0)::bigint AS sum_output,
      COALESCE(SUM(cache_read_tokens), 0)::bigint AS sum_cache_read,
      COALESCE(SUM(cache_create_tokens), 0)::bigint AS sum_cache_create,
      COALESCE(AVG(duration_ms), 0)::float AS mean_duration_ms
    FROM ai_calls
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY call_type, model
  `)) as unknown as Array<{
    call_type: string;
    model: string;
    count: number;
    error_count: number;
    sum_input: string | number;
    sum_output: string | number;
    sum_cache_read: string | number;
    sum_cache_create: string | number;
    mean_duration_ms: number;
  }>;
  // Aggregate by call_type, summing across models (most callers
  // only care about narration vs classifier vs tone). Cost is
  // computed per-row using each row's model rate.
  const byCallType = new Map<string, AiCallBucket>();
  for (const r of rows) {
    const rate = RATES[r.model] ?? { input: 0, output: 0 };
    const inTokens = Number(r.sum_input);
    const outTokens = Number(r.sum_output);
    const cacheRead = Number(r.sum_cache_read);
    // Cache reads are billed at ~10% of input — approximate.
    const dollars =
      ((inTokens + cacheRead * 0.1) * rate.input) / 1_000_000 +
      (outTokens * rate.output) / 1_000_000;
    const cur = byCallType.get(r.call_type);
    if (cur) {
      cur.count += r.count;
      cur.errorCount += r.error_count;
      cur.sumInputTokens += inTokens;
      cur.sumOutputTokens += outTokens;
      cur.sumCostUsd += dollars;
      cur.meanDurationMs =
        (cur.meanDurationMs * (cur.count - r.count) +
          r.mean_duration_ms * r.count) /
        cur.count;
    } else {
      byCallType.set(r.call_type, {
        callType: r.call_type,
        count: r.count,
        errorCount: r.error_count,
        sumInputTokens: inTokens,
        sumOutputTokens: outTokens,
        sumCostUsd: dollars,
        meanDurationMs: r.mean_duration_ms,
      });
    }
  }
  return [...byCallType.values()].sort((a, b) => b.count - a.count);
}

async function sessionStats(): Promise<{
  activeLast1h: number;
  totalTurnsLast24h: number;
}> {
  const rows = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL '1 hour'
                          THEN session_id END)::int AS active_1h,
      COUNT(*) FILTER (WHERE kind = 'turn.begun'
                        AND created_at >= NOW() - INTERVAL '24 hours')::int
        AS turns_24h
    FROM events
  `)) as unknown as Array<{ active_1h: number; turns_24h: number }>;
  const r = rows[0] ?? { active_1h: 0, turns_24h: 0 };
  return { activeLast1h: r.active_1h, totalTurnsLast24h: r.turns_24h };
}

async function errorStats(): Promise<{ toolValidationFailedLast1h: number }> {
  const rows = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM events
    WHERE kind = 'tool_validation_failed'
      AND created_at >= NOW() - INTERVAL '1 hour'
  `)) as unknown as Array<{ n: number }>;
  return { toolValidationFailedLast1h: rows[0]?.n ?? 0 };
}

export async function GET() {
  const t0 = Date.now();
  const [aiCalls, sessions, errors] = await Promise.all([
    aiCallStats().catch(() => [] as AiCallBucket[]),
    sessionStats().catch(() => ({ activeLast1h: 0, totalTurnsLast24h: 0 })),
    errorStats().catch(() => ({ toolValidationFailedLast1h: 0 })),
  ]);
  const mem = process.memoryUsage();
  return NextResponse.json({
    service: "reincarnated-rpg",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    process: {
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
    },
    sentry: { configured: isSentryConfigured() },
    aiCalls,
    sessions,
    errors,
  });
}
