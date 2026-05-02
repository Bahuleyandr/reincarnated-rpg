/**
 * Intent classifier — Day-6 (M1) regex version.
 *
 * Maps free-text input to a verb from the form's whitelist + a
 * confidence in [0, 1]. Day 9 swaps in a Haiku 4.5 free-text →
 * structured-output classifier; the regex version remains as the
 * fallback when confidence < threshold.
 *
 * Strategy:
 *  1. Direct word-boundary match on the verb name (with `_` → ` `).
 *  2. Curated synonym map per verb (form-agnostic in spirit, but
 *     today only the slime's verbs are wired).
 *  3. Fallback to "wait" with low confidence so the orchestrator
 *     always has SOMETHING to advance.
 */
import type { FormTemplate } from "./types";

export interface ClassifierResult {
  verb: string;
  confidence: number;
}

const SLIME_SYNONYMS: Record<string, string[]> = {
  ooze: ["move", "go", "slide", "crawl", "creep", "flow", "slip", "head", "travel"],
  sense_tremor: ["sense", "feel", "listen", "hear", "perceive", "scan", "detect"],
  absorb: ["eat", "consume", "engulf", "ingest", "envelop", "swallow"],
  dissolve: ["destroy", "break", "melt", "corrode", "etch"],
  smother: ["attack", "smash", "fight", "kill", "strike", "engulf"],
  split: ["divide", "split", "fork", "fission"],
  mimic_shape: ["disguise", "hide", "camouflage", "shape", "mimic"],
  wait: ["wait", "rest", "pause", "still", "remain"],
};

export function classify(
  input: string,
  form: FormTemplate,
): ClassifierResult {
  const lowered = input.toLowerCase();

  // 1. Direct verb match (with underscore → space).
  for (const verb of form.verbs) {
    const phrase = verb.replace(/_/g, " ");
    if (new RegExp(`\\b${escape(phrase)}\\b`).test(lowered)) {
      return { verb, confidence: 1.0 };
    }
  }

  // 2. Synonym match (only for verbs the form actually has).
  for (const verb of form.verbs) {
    const syns = SLIME_SYNONYMS[verb];
    if (!syns) continue;
    for (const s of syns) {
      if (new RegExp(`\\b${escape(s)}\\b`).test(lowered)) {
        return { verb, confidence: 0.7 };
      }
    }
  }

  // 3. Fallback.
  const fallback = form.verbs.includes("wait") ? "wait" : form.verbs[0];
  return { verb: fallback, confidence: 0.2 };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
