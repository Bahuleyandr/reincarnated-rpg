/**
 * Provider factory. Reads AI_PROVIDER env (defaults to "anthropic").
 * Cached singleton per provider name so subsequent calls reuse the
 * same client / fetch session.
 */
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

/** Test-only — clears the singleton so a new env can take effect. */
export function _resetProviderCacheForTests(): void {
  cached = null;
  cachedName = null;
}
