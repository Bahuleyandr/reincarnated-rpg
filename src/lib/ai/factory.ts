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
  /** The narration model. */
  modelOverride: string | null;
  /** Cheap-model override for the LLM classifier path (when
   *  useLlmClassifier=true). Falls back to modelOverride when null. */
  classifierModelOverride: string | null;
  /** Cheap-model override for the LLM tone judge (when
   *  useLlmTone=true). Falls back to modelOverride. */
  toneModelOverride: string | null;
  /** Whether to actually invoke the LLM classifier on the hot path. */
  useLlmClassifier: boolean;
  /** Whether to actually invoke the LLM tone judge after the regex layer. */
  useLlmTone: boolean;
}

function envDefault(): ResolvedProvider {
  return {
    provider: getProvider(),
    source: "env-default",
    modelOverride: null,
    classifierModelOverride: null,
    toneModelOverride: null,
    useLlmClassifier: false,
    useLlmTone: false,
  };
}

/**
 * Async resolver. If the user has a row in user_llm_prefs, builds a
 * provider with their saved key + baseUrl + model. Otherwise falls
 * back to the env-default singleton.
 *
 * `pinnedNarrationModel` (per-campaign voice continuity) wins over
 * the user's current `prefs.model` when supplied — the campaign keeps
 * its starting model. The provider+key still come from current prefs
 * (we don't ship encrypted keys into campaign rows), so changing
 * preset away from the pinned one falls back to env-default.
 */
export async function getProviderForUser(
  db: Db,
  userId: string | null | undefined,
  pin?: {
    pinnedPresetId?: string | null;
    pinnedNarrationModel?: string | null;
  },
): Promise<ResolvedProvider> {
  if (!userId) return envDefault();

  const rows = await db
    .select()
    .from(userLlmPrefs)
    .where(eq(userLlmPrefs.userId, userId))
    .limit(1);
  const prefs = rows[0];
  if (!prefs) return envDefault();

  const preset: LlmPreset | undefined = findPreset(prefs.presetId);
  if (!preset) return envDefault();

  // Pin guard: if the campaign was started under a different preset
  // than the user is currently configured with, the user-specific
  // key won't match the pinned model's API. Drop to env-default for
  // safety. (User can re-pick that preset on /settings to re-engage.)
  if (
    pin?.pinnedPresetId &&
    pin.pinnedPresetId !== prefs.presetId
  ) {
    return envDefault();
  }

  const apiKey = prefs.apiKeyEnc ? decryptSecret(prefs.apiKeyEnc) : "";
  const narrationModel = pin?.pinnedNarrationModel || prefs.model;
  const classifierModel = prefs.classifierModel || null;
  const toneModel = prefs.toneModel || null;
  const useLlmClassifier = prefs.useLlmClassifier === "true";
  const useLlmTone = prefs.useLlmTone === "true";

  if (prefs.providerKind === "anthropic") {
    return {
      provider: new AnthropicProvider({ apiKey }),
      source: prefs.presetId,
      modelOverride: narrationModel,
      classifierModelOverride: classifierModel,
      toneModelOverride: toneModel,
      useLlmClassifier,
      useLlmTone,
    };
  }
  // openai-compatible — every non-anthropic preset
  const baseUrl = prefs.baseUrl ?? preset.baseUrl ?? "";
  return {
    provider: new OpenAICompatibleProvider(
      baseUrl,
      apiKey || "ollama",
    ),
    source: prefs.presetId,
    modelOverride: narrationModel,
    classifierModelOverride: classifierModel,
    toneModelOverride: toneModel,
    useLlmClassifier,
    useLlmTone,
  };
}

/** Test-only — clears the singleton so a new env can take effect. */
export function _resetProviderCacheForTests(): void {
  cached = null;
  cachedName = null;
}
