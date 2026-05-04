/**
 * Narration mood presets. Each preset is a short paragraph the
 * narrator's system prompt prepends (or appends, depending on the
 * narrator implementation) to nudge tone without changing
 * mechanics.
 *
 * Three buckets:
 *   - cozy: warmth and small kindnesses; hard-moves sting but
 *     don't maim; mistakes are recoverable.
 *   - standard: the default voice — no addition.
 *   - brutal: indifferent world; hard-moves bite; failures cost.
 *
 * The preset resolves through a fallback chain:
 *   sessions.mood_preset (per-campaign override)
 *   ↓ users.mood_preset (per-user default)
 *   ↓ "standard" (anon / unset)
 */
export type MoodPreset = "cozy" | "standard" | "brutal";

const FRAGMENTS: Record<MoodPreset, string> = {
  standard: "",
  cozy: [
    "TONE NUDGE — cozy:",
    "Lean toward warmth and small kindnesses. Hard moves should sting,",
    "but never maim. Let mistakes be recoverable. Let beauty intrude on",
    "the dark places.",
  ].join(" "),
  brutal: [
    "TONE NUDGE — brutal:",
    "Treat the world as indifferent. Hard moves should bite. Failures cost.",
    "Spare no false comfort. Beauty appears only by contrast.",
  ].join(" "),
};

export function moodPromptFragment(mood: MoodPreset | string | null | undefined): string {
  if (!mood || mood === "standard") return "";
  if (mood === "cozy" || mood === "brutal") {
    return FRAGMENTS[mood];
  }
  return ""; // unknown values silently ignored
}

export function isValidMood(value: unknown): value is MoodPreset {
  return value === "cozy" || value === "standard" || value === "brutal";
}

export function resolveMood(
  sessionMood: string | null | undefined,
  userMood: string | null | undefined,
): MoodPreset {
  if (isValidMood(sessionMood)) return sessionMood;
  if (isValidMood(userMood)) return userMood;
  return "standard";
}
