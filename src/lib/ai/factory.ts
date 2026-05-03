/**
 * Provider factory.
 *
 * Three flavors:
 *   - getProvider(name?)            : sync, env-driven. Reads
 *                                     AI_PROVIDER + the relevant
 *                                     {ANTHROPIC,OPENAI}_* env vars.
 *                                     This is the deploy-default.
 *   - getProviderForUser(db, uid)   : async, reads user_llm_prefs and
 *                                     constructs a provider with the
 *                                     user's saved key/baseUrl/model.
 *                                     Falls back to getProvider() when
 *                                     uid is null/undefined or when
 *                                     the user has no prefs row.
 *   - resolveProvider(db, uid)      : convenience wrapper that returns
 *                                     { provider, modelOverrides }
 *                                     where modelOverrides lets the
 *                                     caller substitute the configured
 *                                     model for narration / classifier
 *                                     calls.
 *
 * Env-default singleton is cached. Per-user providers are not cached
 * across requests — the prefs row is only ~1 PK lookup, and avoiding
 * caching means a user changing their prefs takes effect on the next
 * turn.
 */
import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { userLlmPrefs } from "../db/schema";
import { decryptSecret } from "../util/crypto";

import { findPreset, type LlmPreset } from "./presets";
import type { AIProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";

export type ProviderName = "anthropic" | "openai-compatible";

let cached: AIProvider | null = null;
let cachedName: ProviderName | null = null;

export function getProvider(name?: ProviderName): AIProvider {
  const target =
    name ??
    ((process.env.AI_PROVIDER ?? "anthropic").toLowerCase() as ProviderName);

  if (cached && cachedName === target) return cached;

  switch (target) {
    case "openai-compatible":
      cached = new OpenAICompatibleProvider();
      break;
    case "anthropic":
    default:
      cached = new AnthropicProvider();
      break;
  }
  cachedName = target;
  return cached;
}

export interface ResolvedProvider {
  provider: AIProvider;
  /** Preset id ("anthropic", "minimax", "openrouter", ...) when the
   *  user has explicit prefs; "env-default" otherwise. */
  source: string;
  /** The model the user picked. When set, the narrator / classifier
   *  should use this instead of their hard-coded model strings (the
   *  same model handles both calls; we don't run a separate Haiku for
   *  third-party providers — it's not worth the wiring complexity). */
  modelOverride: string | null;
}

/**
 * Async resolver. If the user has a row in user_llm_prefs, builds a
 * provider with their saved key + baseUrl + model. Otherwise falls
 * back to the env-default singleton.
 */
export async function getProviderForUser(
  db: Db,
  userId: string | null | undefined,
): Promise<ResolvedProvider> {
  if (!userId) {
    return {
      provider: getProvider(),
      source: "env-default",
      modelOverride: null,
    };
  }
  const rows = await db
    .select()
    .from(userLlmPrefs)
    .where(eq(userLlmPrefs.userId, userId))
    .limit(1);
  const prefs = rows[0];
  if (!prefs) {
    return {
      provider: getProvider(),
      source: "env-default",
      modelOverride: null,
    };
  }

  const preset: LlmPreset | undefined = findPreset(prefs.presetId);
  // If the preset id was deleted in code, fail safe to env-default.
  if (!preset) {
    return {
      provider: getProvider(),
      source: "env-default",
      modelOverride: null,
    };
  }

  const apiKey = prefs.apiKeyEnc ? decryptSecret(prefs.apiKeyEnc) : "";

  if (prefs.providerKind === "anthropic") {
    return {
      provider: new AnthropicProvider({ apiKey }),
      source: prefs.presetId,
      modelOverride: prefs.model,
    };
  }
  // openai-compatible — every non-anthropic preset
  const baseUrl = prefs.baseUrl ?? preset.baseUrl ?? "";
  return {
    provider: new OpenAICompatibleProvider(
      baseUrl,
      apiKey || "ollama", // ollama-local convention; constructor requires a non-empty string
    ),
    source: prefs.presetId,
    modelOverride: prefs.model,
  };
}

/** Test-only — clears the singleton so a new env can take effect. */
export function _resetProviderCacheForTests(): void {
  cached = null;
  cachedName = null;
}
