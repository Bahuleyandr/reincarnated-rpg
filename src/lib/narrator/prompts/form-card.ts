/**
 * Generic form card builder — works for ANY content/forms/*.json.
 *
 * Reads the JSON template at runtime and produces the prompt fragment
 * that sits below SYSTEM_PROMPT in the RemoteNarrator. Embedding the
 * negativeVocab + hardMoves + sample corpus inline gives the model
 * one-shot exemplars for whatever form the player started in.
 *
 * Originally `buildSlimeFormCard` (Day 8); renamed when we added
 * cursed-book, dragon-egg, dungeon-core, and the open-ended
 * generic-creature path.
 */

export interface FormJson {
  id: string;
  displayName: string;
  tagline: string;
  vitals: Record<string, { max: number; start: number; death?: number | null }>;
  stats: Record<string, number>;
  verbs: string[];
  verbMappings: Record<string, { tools: string[]; rollStat: string | null }>;
  negativeVocab: { rule: string; words: string[] };
  hardMoves: {
    rule: string;
    moves: Array<{ id: string; narrative: string; tools: unknown[] }>;
  };
  sampleCorpus: {
    rule: string;
    passages: Array<{
      id: string;
      scenario: string;
      wordCount: number;
      text: string;
    }>;
  };
}

export function buildFormCard(form: FormJson): string {
  const negVocabList = form.negativeVocab.words.join(", ");
  const negVocabBlock = form.negativeVocab.words.length
    ? `NEGATIVE VOCABULARY — MUST NOT APPEAR in second-person narration about the player:
${negVocabList}
(NPCs and the surrounding world may still have hands, eyes, voices, etc.)`
    : `NEGATIVE VOCABULARY — none declared for this form. The narrator should still match the form the player declared (carried in the user message as you_are) and avoid generic-fantasy filler that conflicts with the form's actual capabilities.`;
  const verbs = form.verbs.join(", ");
  const moves = form.hardMoves.moves
    .map((m, i) => `  ${i + 1}. ${m.id}: ${m.narrative}`)
    .join("\n");
  const corpus = form.sampleCorpus.passages
    .map(
      (p) =>
        `--- ${p.id} (${p.scenario}) ---
${p.text}`,
    )
    .join("\n\n");

  return `Form: ${form.displayName}
Tagline: ${form.tagline}

Vitals: ${Object.entries(form.vitals)
    .map(
      ([n, v]) =>
        `${n} (max ${v.max}, ${v.death === undefined || v.death === null ? "non-lethal" : `death at ${v.death}`})`,
    )
    .join(", ")}
Stats: ${Object.entries(form.stats)
    .map(([n, v]) => `${n}=${v >= 0 ? "+" : ""}${v}`)
    .join(", ")}
Verbs the player may attempt: ${verbs}

${negVocabBlock}

HARD-MOVE MENU (pick exactly one on a 7-9 partial-success):
${moves}

ONE-SHOT EXEMPLARS — match this tone, register, sentence cadence, and vocabulary:

${corpus}
`;
}

/** @deprecated Use buildFormCard. Kept as alias for any in-flight imports. */
export const buildSlimeFormCard = buildFormCard;
