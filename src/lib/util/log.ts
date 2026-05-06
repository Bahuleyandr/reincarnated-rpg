/**
 * Minimal structured logger. JSON-line output to stdout/stderr; no
 * external deps. The shape matches what Fly.io's log shipper expects.
 *
 * `log.info("turn.start", { sessionId, turn })` →
 *   {"level":"info","msg":"turn.start","ts":"2026-...","sessionId":"...","turn":1}
 */

type LogLevel = "debug" | "info" | "warn" | "error";

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
  const entry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) =>
    emit("error", msg, fields),
};

/**
 * Canonical end-of-turn log. Centralises the field shape so log
 * pipelines (Fly logs, /api/metrics, future Loki queries) can rely
 * on a stable schema. Emitted once per `runTurn` call regardless of
 * outcome — `success` distinguishes happy-path from refusal /
 * tool-validation-failed / network-error.
 *
 * Sample line:
 *   {"level":"info","msg":"turn.completed","ts":"...","sessionId":"...",
 *    "formId":"lesser-slime","locationId":"collapsed-tunnel","turn":3,
 *    "narratorMode":"template","latencyMs":42,"success":true,
 *    "beatsFiredCount":1}
 *
 * POLISH_PLAN sub-phase 0b.3.
 */
export interface TurnCompletedFields {
  sessionId: string;
  /** Player's current form id (e.g. "lesser-slime"). */
  formId: string;
  /** Player's current location id (e.g. "collapsed-tunnel"). */
  locationId: string;
  /** 1-indexed turn number after the turn lands. */
  turn: number;
  /** "template" | "remote" — which narrator handled this turn. */
  narratorMode: "template" | "remote";
  /** End-to-end runTurn latency, milliseconds. */
  latencyMs: number;
  /** True for happy-path turns; false for any error / refusal /
   *  validation-failed path. */
  success: boolean;
  /** Number of arc beats that fired in this turn (0 when no
   *  beat-pack or no triggers matched). */
  beatsFiredCount: number;
  /** Logged-in user id when known; null for anon sessions. */
  userId?: string | null;
  /** BYO-LLM preset id for cost telemetry; null for env-default
   *  / template runs. */
  presetId?: string | null;
  /** Reason when success=false. e.g. "tool_validation_failed",
   *  "narrator_error", "moderation_severe". */
  errorReason?: string;
}

export function logTurnCompleted(fields: TurnCompletedFields): void {
  emit("info", "turn.completed", fields as unknown as Record<string, unknown>);
}
