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
