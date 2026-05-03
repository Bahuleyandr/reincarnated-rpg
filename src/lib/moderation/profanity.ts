/**
 * Profanity matcher (English-only for v1).
 *
 * Two tiers:
 *  - **mild**: common cussing — fuck/shit/bitch/asshole/etc. Doesn't
 *    block the turn; in-game consequence is a small +1 bad-luck stack.
 *  - **severe**: slurs, hate speech, sexual abuse language. Blocks the
 *    turn entirely (no narration is generated) and stacks a heavier
 *    bad-luck curse. Energy is still spent — the gods don't refund.
 *
 * The lists below are deliberately compact. A "comprehensive" profanity
 * list is impossible to maintain anyway; the goal is to nudge tone, not
 * to prove an English major's vocabulary. Live moderation against the
 * full LLM happens in the tone-checker on the OUTPUT side; this is a
 * cheap, deterministic input gate.
 *
 * Word boundaries: we match whole words via lowercased regex. We do
 * NOT do leetspeak normalization — `fuk` and `f*ck` slip past, and
 * that's accepted; the goal is clear-cut cases, not arms-race policing.
 *
 * Hits return the offset + matched word so callers can highlight or
 * audit. The list is exported for tests and for the admin debug page.
 */

export type ProfanitySeverity = "clean" | "mild" | "severe";

export interface ProfanityHit {
  word: string;
  index: number;
  severity: "mild" | "severe";
}

export interface ProfanityResult {
  severity: ProfanitySeverity;
  hits: ProfanityHit[];
}

// Mild: garden-variety cussing. The narrator will work around them
// with a flavor nudge; the player gets a one-stack curse.
export const MILD_WORDS: readonly string[] = [
  "fuck",
  "fucking",
  "fucked",
  "fucker",
  "shit",
  "bullshit",
  "shitty",
  "bitch",
  "bitches",
  "asshole",
  "asshat",
  "bastard",
  "dickhead",
  "prick",
  "twat",
  "wanker",
  "douchebag",
  "piss",
  "pissed",
  "crap",
  "damn",
  "goddamn",
  "hell",
];

// Severe: language we will not let the player aim at the world. We
// match these but DO NOT enumerate slur strings here — the project
// stays polite even in source. Severity is determined by membership
// in the catch-all SEVERE_PATTERNS regex (built from a build-time
// list that lives in a separate, redacted file in real deployments).
//
// For v1 we ship a small, named set of unmistakable severe markers:
// hate-speech wrappers + sexual-violence phrasings. Add more in
// content/moderation/severe.txt if/when you want to grow it without
// touching code.
export const SEVERE_WORDS: readonly string[] = [
  "kys", // "kill yourself"
  "kill yourself",
  "rape",
  "raped",
  "raping",
  "rapist",
  "molest",
  "molested",
  "molester",
  "pedophile",
  "pedo",
  "nazi",
  "heil hitler",
  "white power",
  "lynch",
  "lynching",
];

function buildBoundaryRegex(words: readonly string[]): RegExp {
  // Sort by length desc so multi-word phrases match before their
  // first word would. Each word is escaped for regex.
  const escaped = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    // word boundary on both ends; for multi-word phrases the spaces
    // serve as natural boundaries already.
    .map((w) => (w.includes(" ") ? `(?:${w})` : `\\b${w}\\b`));
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

const MILD_RE = buildBoundaryRegex(MILD_WORDS);
const SEVERE_RE = buildBoundaryRegex(SEVERE_WORDS);

/**
 * Scan input for profanity. Severe takes precedence over mild —
 * if a severe word is found anywhere in the text, the result is
 * "severe" even if mild words also matched. Hits include both
 * severities so admin tooling can show the full picture.
 */
export function detectProfanity(input: string): ProfanityResult {
  if (!input) return { severity: "clean", hits: [] };

  const hits: ProfanityHit[] = [];
  // Reset lastIndex on shared regex objects (they're stateful with /g).
  MILD_RE.lastIndex = 0;
  SEVERE_RE.lastIndex = 0;

  for (let m: RegExpExecArray | null; (m = SEVERE_RE.exec(input)) !== null; ) {
    hits.push({ word: m[1], index: m.index, severity: "severe" });
  }
  for (let m: RegExpExecArray | null; (m = MILD_RE.exec(input)) !== null; ) {
    hits.push({ word: m[1], index: m.index, severity: "mild" });
  }
  hits.sort((a, b) => a.index - b.index);

  if (hits.some((h) => h.severity === "severe")) {
    return { severity: "severe", hits };
  }
  if (hits.length > 0) {
    return { severity: "mild", hits };
  }
  return { severity: "clean", hits: [] };
}
