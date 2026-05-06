/**
 * Next 16 instrumentation hook. Runs once at server start, then
 * `onRequestError` fires on every server-side error.
 *
 * We thread server errors through our minimal Sentry-envelope
 * wrapper (lib/observability/sentry.ts). When SENTRY_DSN is unset
 * the wrapper no-ops, so this file is safe to ship without any
 * env config.
 *
 * `register()` is intentionally cheap — Sentry needs no setup; the
 * wrapper reads env lazily on first capture. We log a single line
 * announcing whether Sentry is wired so deploys are auditable.
 *
 * Reference: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md
 */
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  // Defer import — instrumentation.ts is loaded VERY early (before
  // even the env validator runs), and we want to keep the synchronous
  // path zero. Lazy-import + lazy-log on first errored request.
  const { isSentryConfigured } = await import(
    "./src/lib/observability/sentry"
  );
  const { log } = await import("./src/lib/util/log");
  log.info("instrumentation.register", {
    sentry: isSentryConfigured(),
  });
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  const { captureException } = await import(
    "./src/lib/observability/sentry"
  );
  await captureException(err, {
    tags: {
      route: request.path,
      method: request.method,
      routerKind: context.routerKind,
      routePath: context.routePath,
      routeType: context.routeType,
    },
    extra: {
      revalidateReason: context.revalidateReason,
      headers: redactHeaders(request.headers),
    },
  });
};

/** Strip cookies + auth headers before forwarding to Sentry — never
 *  leak session credentials into the error tracker. */
function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const sensitive = new Set(["cookie", "authorization", "x-api-key"]);
  for (const [k, v] of Object.entries(headers)) {
    if (sensitive.has(k.toLowerCase())) continue;
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(", ");
  }
  return out;
}
