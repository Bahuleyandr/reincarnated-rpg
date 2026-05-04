/**
 * Zod-validated environment access. Lazy + cached: read once on first
 * call, throw clearly on missing/invalid values.
 *
 * Server-only — Next.js will tree-shake this out of any client bundle
 * because we never reference it from a "use client" file.
 */
import { z } from "zod";

const schema = z.object({
  /** Pooled connection URL — used by the app for normal queries.
   *  In production this should point at Neon's pgbouncer pooler
   *  (URL contains `-pooler.` and uses `?pgbouncer=true`). */
  DATABASE_URL: z.string().min(1),
  /** Direct (unpooled) connection URL — used by migrations and
   *  long-running admin tasks. PgBouncer in transaction-pool mode
   *  breaks DDL because it can't share session-scoped state across
   *  transactions. Fall back to DATABASE_URL when not set
   *  (acceptable in dev where there's no pooler). */
  DATABASE_URL_DIRECT: z.string().optional(),
  /** Max pooled connections held by this app instance. Default 10
   *  is conservative — Neon free tier caps total connections at
   *  100, so 10 leaves room for migrations + admin tools + a small
   *  hot-reload safety margin in dev. */
  DATABASE_POOL_MAX: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 10))
    .pipe(z.number().int().min(1).max(50)),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be 16+ bytes"),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  AI_PROVIDER: z
    .enum(["anthropic", "openai-compatible"])
    .default("anthropic"),
  NARRATOR: z.enum(["template", "remote"]).default("template"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  - ");
    throw new Error(`env validation failed:\n  - ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clears the cache so subsequent env() calls re-read. */
export function _resetEnvCacheForTests(): void {
  cached = null;
}
