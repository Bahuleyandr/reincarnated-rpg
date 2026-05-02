/**
 * Slime form card — built from `content/forms/lesser-slime.json`.
 *
 * `buildSlimeFormCard` reads the JSON template at runtime and produces
 * the prompt fragment that sits below SYSTEM_PROMPT in the RemoteNarrator
 * (Day 8). Embedding the negativeVocab + hardMoves + sample corpus
 * inline gives the model one-shot exemplars for the slime POV.
 */

interface SlimeFormJson {
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

export function buildSlimeFormCard(form: SlimeFormJson): string {
  const negVocab = form.negativeVocab.words.join(", ");
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

NEGATIVE VOCABULARY — MUST NOT APPEAR in second-person narration about the player:
${negVocab}
(NPCs and the surrounding world may still have hands, eyes, voices, etc.)

HARD-MOVE MENU (pick exactly one on a 7-9 partial-success):
${moves}

ONE-SHOT EXEMPLARS — match this tone, register, sentence cadence, and vocabulary:

${corpus}
`;
}
