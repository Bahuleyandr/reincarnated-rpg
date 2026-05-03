/**
 * Zod-validated environment access. Lazy + cached: read once on first
 * call, throw clearly on missing/invalid values.
 *
 * Server-only — Next.js will tree-shake this out of any client bundle
 * because we never reference it from a "use client" file.
 */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
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
