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
 *  2. Curated synonym map per form + verb.
 *  3. Fallback to "wait" with low confidence so the orchestrator
 *     always has SOMETHING to advance.
 */
import type { FormTemplate } from "./types";

export interface ClassifierResult {
  verb: string;
  confidence: number;
}

const FORM_SYNONYMS: Record<string, Record<string, string[]>> = {
  "lesser-slime": {
    ooze: ["move", "go", "slide", "crawl", "creep", "flow", "slip", "head", "travel"],
    sense_tremor: ["sense", "feel", "listen", "hear", "perceive", "scan", "detect"],
    absorb: ["eat", "consume", "engulf", "ingest", "envelop", "swallow"],
    dissolve: ["destroy", "break", "melt", "corrode", "etch"],
    smother: ["attack", "smash", "fight", "kill", "strike", "engulf"],
    split: ["divide", "split", "fork", "fission"],
    mimic_shape: ["disguise", "hide", "camouflage", "shape", "mimic"],
    wait: ["wait", "rest", "pause", "still", "remain"],
  },
  "cursed-book": {
    fall_open: ["open", "fall open", "show page", "reveal", "display"],
    snap_shut: ["close", "shut", "slam", "trap", "bite"],
    flutter_pages: ["flutter", "rustle", "turn pages", "flip", "riffle"],
    absorb_word: ["read", "consume word", "copy", "take word", "absorb"],
    bleed_ink: ["bleed", "leak ink", "write", "smear"],
    rewrite_self: ["rewrite", "edit", "change text", "alter myself"],
    decode_passage: ["decode", "translate", "understand", "parse"],
    bind_reader: ["influence", "compel", "bind", "suggest", "plant thought"],
    spark_marginalia: ["marginalia", "note", "glow", "annotate"],
    wyrm_inscription: ["wyrm", "inscription", "ancient text"],
    wait_for_a_reader: ["wait for reader", "wait for someone", "remain open"],
    wait: ["wait", "rest", "pause"],
  },
  "dragon-egg": {
    rock: ["move", "rock", "roll", "wobble", "shake"],
    hum_low: ["hum", "vibrate", "pulse sound", "call softly"],
    kindle_glow: ["glow", "warm", "ignite", "kindle", "shine"],
    listen: ["listen", "hear", "sense", "feel", "detect"],
    absorb_warmth: ["absorb", "drink heat", "take warmth", "soak warmth"],
    dream_outward: ["dream", "reach out", "project", "touch mind"],
    hatch_partial: ["crack", "hatch", "break shell", "push out"],
    warmth_pulse: ["pulse", "flash warmth", "signal warmth"],
    shell_song: ["sing", "resonate", "shell song"],
    memory_dream: ["remember", "memory", "bloodline", "ancestral"],
    wyrm_kin_call: ["wyrm", "kin call", "ancient call"],
    wait: ["wait", "rest", "stay still"],
  },
  "dungeon-core": {
    spawn_minion: ["spawn", "summon", "create minion", "make servant"],
    shape_room: ["shape", "reshape", "change room", "move wall", "carve"],
    lure: ["lure", "bait", "draw", "tempt"],
    sense_intruder: ["sense", "listen", "detect", "scan", "feel footsteps"],
    weave_illusion: ["illusion", "hide", "veil", "fake"],
    drain_mana: ["drain mana", "recover mana", "sip mana"],
    bleed_integrity: ["damage self", "bleed", "sacrifice integrity"],
    deepen_chamber: ["deepen", "expand", "dig", "extend chamber"],
    siphon_intruder: ["siphon", "drain intruder", "leech"],
    false_room: ["false room", "fake room", "decoy room"],
    bind_minion: ["bind", "command minion", "control minion"],
    wyrm_signal: ["wyrm", "signal", "deep pulse"],
    wait: ["wait", "rest", "hold"],
  },
  "generic-creature": {
    move: ["go", "walk", "crawl", "roll", "float", "shift", "travel"],
    sense: ["sense", "feel", "listen", "look", "detect", "scan"],
    act: ["act", "try", "do", "use"],
    attack: ["attack", "hit", "strike", "fight", "bite", "smash"],
    defend: ["defend", "guard", "brace", "block", "hide"],
    examine: ["examine", "inspect", "study", "search"],
    speak: ["speak", "talk", "call", "say", "whisper"],
    emit: ["emit", "glow", "pulse", "signal"],
    alter: ["alter", "change", "shape", "transform"],
    contain: ["contain", "hold", "absorb", "swallow"],
    wait: ["wait", "rest", "pause"],
  },
};

export function classify(input: string, form: FormTemplate): ClassifierResult {
  const lowered = input.toLowerCase();
  const synonyms = FORM_SYNONYMS[form.id] ?? FORM_SYNONYMS["generic-creature"];

  // Build (verb, phrase, confidence) candidate list spanning both
  // direct phrase forms (1.0) and synonyms (0.7). Sort by phrase
  // length descending so compound matches win against shorter
  // overlaps — without this, cursed-book's "wait for a reader"
  // and its "wait for someone" synonym both lose to the
  // short "wait" verb on input like "wait for someone to come".
  const candidates: Array<{
    verb: string;
    phrase: string;
    confidence: number;
  }> = [];
  for (const verb of form.verbs) {
    candidates.push({
      verb,
      phrase: verb.replace(/_/g, " "),
      confidence: 1.0,
    });
    const syns = synonyms[verb];
    if (!syns) continue;
    for (const s of syns) {
      candidates.push({ verb, phrase: s, confidence: 0.7 });
    }
  }
  candidates.sort((a, b) => b.phrase.length - a.phrase.length);
  for (const c of candidates) {
    if (new RegExp(`\\b${escape(c.phrase)}\\b`).test(lowered)) {
      return { verb: c.verb, confidence: c.confidence };
    }
  }

  // Fallback.
  const fallback = form.verbs.includes("wait") ? "wait" : form.verbs[0];
  return { verb: fallback, confidence: 0.2 };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
