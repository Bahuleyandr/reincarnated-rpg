/**
 * Sentry capture stub — Phase 8 Day 72.
 *
 * Lightweight wrapper around @sentry/nextjs. When SENTRY_DSN is
 * unset, all calls are no-ops. Once the SDK is installed and the
 * DSN is set, captureException + captureMessage flow through. The
 * lazy-load keeps the SDK out of the cold-start path until needed.
 *
 * NOT a full integration — sentry.client/server.config.ts files
 * (the next.js convention) need to be added when the SDK lands;
 * this module is the call-site shim everywhere in the codebase.
 */
import { log } from "./log";

let cached: {
  captureException(err: unknown, ctx?: Record<string, unknown>): void;
  captureMessage(msg: string, ctx?: Record<string, unknown>): void;
} | null = null;

async function load(): Promise<typeof cached> {
  if (cached) return cached;
  if (!process.env.SENTRY_DSN) {
    cached = {
      captureException: () => {},
      captureMessage: () => {},
    };
    return cached;
  }
  try {
    // The SDK isn't installed by default. The `new Function`
    // dance prevents TS from resolving the optional dep at
    // compile time.
    const dynImport = new Function("p", "return import(p)") as (
      p: string,
    ) => Promise<unknown>;
    const sentry = (await dynImport("@sentry/nextjs")) as {
      captureException(err: unknown, ctx?: Record<string, unknown>): void;
      captureMessage(msg: string, ctx?: Record<string, unknown>): void;
    };
    cached = {
      captureException: sentry.captureException.bind(sentry),
      captureMessage: sentry.captureMessage.bind(sentry),
    };
  } catch {
    cached = {
      captureException: () => {},
      captureMessage: () => {},
    };
  }
  return cached;
}

export async function captureException(
  err: unknown,
  ctx?: Record<string, unknown>,
): Promise<void> {
  const s = await load();
  s?.captureException(err, ctx);
  log.warn("sentry.exception", {
    err: err instanceof Error ? err.message : String(err),
    ctx,
  });
}

export async function captureMessage(
  msg: string,
  ctx?: Record<string, unknown>,
): Promise<void> {
  const s = await load();
  s?.captureMessage(msg, ctx);
  log.info("sentry.message", { msg, ctx });
}
