/**
 * Minimal Sentry-envelope wrapper. POLISH_PLAN 0b.3.
 *
 * No SDK dep — sends errors via fetch directly to Sentry's
 * documented envelope ingestion endpoint. Trade-off: no automatic
 * transaction tracing, no client-side instrumentation, no source-map
 * upload. For a pre-launch foundation we want explicit + auditable
 * over magical + opaque. Future swap to `@sentry/nextjs` (full SDK
 * with transactions / sessions / breadcrumbs) is straightforward
 * because the call surface here is intentionally minimal.
 *
 * No-op when SENTRY_DSN is unset (i.e. dev / CI / test). This means
 * production code can `captureException(err)` unconditionally without
 * branching on whether Sentry is configured.
 *
 * Protocol references:
 *   https://develop.sentry.dev/sdk/data-model/envelopes/
 *   https://develop.sentry.dev/sdk/data-model/envelope-items/
 *   https://develop.sentry.dev/sdk/research/security/dsn-handling/
 */
import { env } from "../util/env";
import { log } from "../util/log";

interface ParsedDsn {
  publicKey: string;
  host: string;
  projectId: string;
}

/**
 * DSN format: `<protocol>://<publicKey>@<host>/<projectId>`
 *   e.g. `https://abc@o12345.ingest.sentry.io/67890`
 */
function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    // Reconstruct the host with protocol but without auth + path.
    const host = `${url.protocol}//${url.host}`;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

interface SentryConfig {
  parsed: ParsedDsn;
  dsn: string;
  release: string;
  environment: string;
  serverName: string;
}

let cached: SentryConfig | null | undefined = undefined;

function configFromEnv(): SentryConfig | null {
  if (cached !== undefined) return cached;
  const dsn = env().SENTRY_DSN;
  if (!dsn) {
    cached = null;
    return null;
  }
  const parsed = parseDsn(dsn);
  if (!parsed) {
    log.warn("sentry.dsn_parse_failed", { dsn: redactDsn(dsn) });
    cached = null;
    return null;
  }
  cached = {
    parsed,
    dsn,
    release: env().GIT_COMMIT_SHA ?? "unknown",
    environment: env().NODE_ENV,
    serverName: process.env.FLY_REGION ?? process.env.HOSTNAME ?? "local",
  };
  return cached;
}

/** For test-only cache invalidation when env changes mid-run. */
export function _resetSentryCacheForTests(): void {
  cached = undefined;
}

function redactDsn(dsn: string): string {
  // Replace the public key with `<key>` so logs never accidentally
  // surface the credential.
  return dsn.replace(/(:\/\/)([^@]+)(@)/, "$1<key>$3");
}

/**
 * Generate a 32-char hex event id. Sentry requires this exact
 * shape (UUID v4 without hyphens). We use crypto.randomUUID() and
 * strip the hyphens — equivalent randomness, correct format.
 */
function newEventId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

interface ExceptionContext {
  /** Free-form tags surfaced in Sentry's UI (string-only).
   *  e.g. { sessionId, userId, route, narratorMode }. */
  tags?: Record<string, string | undefined | null>;
  /** Free-form structured data — appears in the event detail. */
  extra?: Record<string, unknown>;
  /** "error" | "warning" | "fatal". Default "error". */
  level?: "error" | "warning" | "fatal";
  /** When set, overrides the default fingerprint (Sentry groups by
   *  fingerprint). Use to group related errors that look distinct
   *  by message. */
  fingerprint?: string[];
}

/**
 * Capture an exception. No-op when SENTRY_DSN is unset. Never throws
 * (sentry failures are logged and swallowed so capture never breaks
 * the calling code path).
 */
export async function captureException(
  err: unknown,
  ctx?: ExceptionContext,
): Promise<void> {
  const cfg = configFromEnv();
  if (!cfg) return;
  try {
    const event = buildEventPayload(err, ctx, cfg);
    const envelope = serializeEnvelope(event, cfg);
    const url = `${cfg.parsed.host}/api/${cfg.parsed.projectId}/envelope/`;
    const auth =
      `Sentry sentry_version=7, sentry_key=${cfg.parsed.publicKey}, ` +
      `sentry_client=reincarnated-rpg-min/0.1`;
    // 2s timeout — Sentry shouldn't block the response path. If the
    // ingest endpoint is slow, drop the report and log locally.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-sentry-envelope",
          "x-sentry-auth": auth,
        },
        body: envelope,
        signal: controller.signal,
      });
      if (!res.ok) {
        log.warn("sentry.ingest_non_ok", {
          status: res.status,
          eventId: event.event_id,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    log.warn("sentry.capture_failed", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: "javascript";
  level: "error" | "warning" | "fatal";
  release?: string;
  environment?: string;
  server_name?: string;
  logger: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
  exception: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: Array<{ filename: string; function?: string; lineno?: number; colno?: number }> };
    }>;
  };
}

function buildEventPayload(
  err: unknown,
  ctx: ExceptionContext | undefined,
  cfg: SentryConfig,
): SentryEvent {
  const e = err instanceof Error ? err : new Error(String(err));
  const tags: Record<string, string> = {};
  if (ctx?.tags) {
    for (const [k, v] of Object.entries(ctx.tags)) {
      if (typeof v === "string" && v.length > 0) tags[k] = v;
    }
  }
  return {
    event_id: newEventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: ctx?.level ?? "error",
    release: cfg.release,
    environment: cfg.environment,
    server_name: cfg.serverName,
    logger: "reincarnated-rpg",
    tags,
    extra: ctx?.extra,
    fingerprint: ctx?.fingerprint,
    exception: {
      values: [
        {
          type: e.name || "Error",
          value: e.message || String(err),
          stacktrace: parseStacktrace(e.stack),
        },
      ],
    },
  };
}

function parseStacktrace(
  stack: string | undefined,
): SentryEvent["exception"]["values"][number]["stacktrace"] | undefined {
  if (!stack) return undefined;
  // V8-format stacks: "    at functionName (file:line:col)" or
  // "    at file:line:col". Sentry expects frames in REVERSE order
  // (oldest first). We parse, reverse, and only emit the top 30
  // frames to keep payloads small.
  const lines = stack.split("\n").slice(1);
  const frames: Array<{ filename: string; function?: string; lineno?: number; colno?: number }> = [];
  for (const line of lines) {
    const m = line.match(/^\s+at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) continue;
    frames.push({
      function: m[1],
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
    });
  }
  if (frames.length === 0) return undefined;
  // Sentry: frames in reverse chronological order (oldest at the
  // start of the array, the throwing frame at the end).
  return { frames: frames.reverse().slice(-30) };
}

function serializeEnvelope(event: SentryEvent, cfg: SentryConfig): string {
  const header = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    sdk: { name: "reincarnated-rpg-min", version: "0.1" },
    dsn: cfg.dsn,
  });
  const itemPayload = JSON.stringify(event);
  const itemHeader = JSON.stringify({
    type: "event",
    length: Buffer.byteLength(itemPayload, "utf8"),
  });
  return `${header}\n${itemHeader}\n${itemPayload}\n`;
}

/** Health check used by the metrics endpoint to surface
 *  "is sentry configured?" without leaking the DSN itself. */
export function isSentryConfigured(): boolean {
  return configFromEnv() !== null;
}

/** Internal — exposed for tests. */
export const _internal = {
  parseDsn,
  buildEventPayload,
  serializeEnvelope,
  parseStacktrace,
  newEventId,
};
