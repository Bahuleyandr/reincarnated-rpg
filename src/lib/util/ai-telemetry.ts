/**
 * Per-LLM-call telemetry. Inserts a row into `ai_calls` so cost,
 * latency, and error rate can be queried without grepping JSON-line
 * logs. Designed to be fire-and-forget — never throws back into the
 * caller's hot path. Logs a warning on insert failure and moves on.
 *
 * Call shape mirrors the Anthropic Messages API usage object:
 *   - inputTokens     = un-cached prompt tokens
 *   - cacheReadTokens = served-from-cache tokens (~0.1× price)
 *   - cacheCreateTokens = written-to-cache tokens (~1.25× price)
 *   - outputTokens    = generation tokens
 */
import type { Db } from "../db/client";
import { aiCalls } from "../db/schema";
import { uuidv7 } from "./uuidv7";
import { log } from "./log";

export interface AiCallRecord {
  sessionId?: string | null;
  callType: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
  durationMs?: number;
  success?: boolean;
  errorMsg?: string | null;
}

export async function recordAiCall(
  db: Db,
  rec: AiCallRecord,
): Promise<void> {
  try {
    await db.insert(aiCalls).values({
      id: uuidv7(),
      sessionId: rec.sessionId ?? null,
      callType: rec.callType,
      model: rec.model,
      inputTokens: rec.inputTokens ?? 0,
      outputTokens: rec.outputTokens ?? 0,
      cacheReadTokens: rec.cacheReadTokens ?? 0,
      cacheCreateTokens: rec.cacheCreateTokens ?? 0,
      durationMs: rec.durationMs ?? 0,
      success: rec.success === false ? "false" : "true",
      errorMsg: rec.errorMsg ?? null,
    });
  } catch (err) {
    log.warn("ai_telemetry.insert_failed", {
      callType: rec.callType,
      model: rec.model,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Per-million-token rates as of 2026-04 (matches shared/models.md
 * cached snapshot). Maintain by hand; source of truth is the live
 * Models API. Only models we actually call are listed.
 */
export const MODEL_RATES: Record<
  string,
  { input: number; output: number }
> = {
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Estimate cost in USD for one row.
 *   un-cached input * input_rate
 * + cache_read     * input_rate * 0.1   (read discount)
 * + cache_create   * input_rate * 1.25  (5-minute TTL write premium)
 * + output         * output_rate
 */
export function estimateCostUsd(rec: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}): number {
  const r = MODEL_RATES[rec.model];
  if (!r) return 0;
  const cacheRead = rec.cacheReadTokens ?? 0;
  const cacheCreate = rec.cacheCreateTokens ?? 0;
  const inputCost = (rec.inputTokens / 1_000_000) * r.input;
  const cacheReadCost = (cacheRead / 1_000_000) * r.input * 0.1;
  const cacheCreateCost = (cacheCreate / 1_000_000) * r.input * 1.25;
  const outputCost = (rec.outputTokens / 1_000_000) * r.output;
  return inputCost + cacheReadCost + cacheCreateCost + outputCost;
}
