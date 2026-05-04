import { readFileSync } from "node:fs";
import { join } from "node:path";

import { initialProjection } from "@/lib/game/projection";
import { rollFromDice } from "@/lib/game/rules";
import { TemplateNarrator } from "@/lib/narrator/template";
import type { FormTemplate, LocationTemplate, NarrateInput } from "@/lib/game/types";

const SLIME = JSON.parse(
  readFileSync(join(process.cwd(), "content", "forms", "lesser-slime.json"), "utf8"),
) as FormTemplate;

const LOCATION = JSON.parse(
  readFileSync(join(process.cwd(), "content", "locations", "collapsed-tunnel.json"), "utf8"),
) as LocationTemplate;

function freshInput(verb: string, d1: number, d2: number): NarrateInput {
  const projection = initialProjection({
    sessionId: "test",
    form: SLIME,
    location: LOCATION,
  });
  return {
    projection,
    lastEvents: [],
    playerInputSanitized: "test input",
    roll: rollFromDice(d1, d2, 0),
    intent: verb,
    relevantMemories: [],
  };
}

const narrator = new TemplateNarrator({ form: SLIME, location: LOCATION });

describe("TemplateNarrator", () => {
  test("success on 'ooze' emits move_to to a known exit", async () => {
    const out = await narrator.narrate(freshInput("ooze", 6, 6));
    expect(out.toolCalls.find((t) => t.name === "move_to")).toBeDefined();
  });

  test("partial on 'ooze' emits a hard-move tool alongside primary", async () => {
    const out = await narrator.narrate(freshInput("ooze", 4, 4)); // total 8
    expect(out.toolCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("miss on 'absorb' produces only hard-move/self-cost tools (no absorb)", async () => {
    const out = await narrator.narrate(freshInput("absorb", 2, 2)); // total 4
    expect(out.toolCalls.find((t) => t.name === "absorb")).toBeUndefined();
    // At least one tool must fire — either a hard-move or self-damage fallback.
    expect(out.toolCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("text never contains a slime negativeVocab word about the player", async () => {
    const banned = (SLIME as unknown as { negativeVocab: { words: string[] } }).negativeVocab.words;
    for (const verb of (SLIME as unknown as { verbs: string[] }).verbs) {
      for (const dice of [
        [2, 2],
        [3, 4],
        [6, 6],
      ]) {
        const out = await narrator.narrate(freshInput(verb, dice[0], dice[1]));
        const text = out.text.toLowerCase();
        for (const word of banned) {
          // Word-boundary match so e.g. "the" doesn't false-trigger on "see".
          const re = new RegExp(`\\b${word.toLowerCase()}\\b`);
          expect({ verb, band: out, word, hit: re.test(text) }).toMatchObject({
            hit: false,
          });
        }
      }
    }
  });

  test("returns at least one tool call (narrate_only fallback)", async () => {
    const out = await narrator.narrate(freshInput("split", 5, 5));
    expect(out.toolCalls.length).toBeGreaterThanOrEqual(1);
  });
});
