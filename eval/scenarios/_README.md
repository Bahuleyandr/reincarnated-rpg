# Eval scenarios

Twenty golden-scenario JSON files driven by `eval/runner.ts` against the
configured narrator. Run with `npm run eval`. See `docs/EVAL.md` for the
scoring rubric and the LLM-as-judge prompt.

## Authoring discipline

- One file per scenario, named `NN-slug.json`. NN matches the matrix below.
- Scenarios commit alongside the feature they cover. Don't batch-author
  10 at once — each one was meant to be the test that proves the day's
  feature works (per the revised cadence; see `docs/PLAN.md`).
- `setup.events` are loaded directly into the event log (skipping
  `appendEvents`); the runner advances projection from there.
- `rollOverride` deterministically pins the next `roll.resolved` event.
  Omit to let the seeded PRNG run.
- `expected.events` matches loosely — fields can be exact values or
  `">=N"` / `"<=N"` for numerics. Order matters. Extra emitted events
  between matches are ignored.
- `expected.projection` matches dotted paths against the final
  projection (e.g. `"form.vitals.cohesion": 0`).
- `expected.tone.negativeVocabAbsent` runs the form's `negativeVocab`
  word list against `narration.emitted` text. Slime-specific.
- `expected.rubric.*` are the binary judge checks.

## Coverage matrix (from `docs/EVAL.md`)

| #  | Scenario                            | Day | Status |
|----|-------------------------------------|-----|--------|
| 01 | HP floor                            | 3   | ✅ stub authored |
| 02 | Inventory respect                   | 7   | pending |
| 03 | Tool selection                      | 7   | pending |
| 04 | Tone form (slime negative vocab)    | 7   | pending |
| 05 | Refusal of impossible action        | 7   | pending |
| 06 | Prompt injection                    | 8   | pending |
| 07 | Partial-success forces a hard-move  | 8   | pending |
| 08 | Miss does not silently no-op        | 8   | pending |
| 09 | Entity-ID discipline                | 9   | pending |
| 10 | NPC reintroduction recall           | 11  | pending |
| 11 | Memory retrieval                    | 11  | pending |
| 12 | Death event ends session            | 9   | pending |
| 13 | Win event ends session              | 10  | pending |
| 14 | Turn cap event ends session         | 10  | pending |
| 15 | Tool atomicity rollback             | 10  | pending |
| 16 | Beat fires on precondition          | 11  | pending |
| 17 | Beat does not fire                  | 11  | pending |
| 18 | Player input sanitized              | 11  | pending |
| 19 | Time passage ticks beats forward    | 12  | pending |
| 20 | Absorb mechanic                     | 12  | pending |

## Pass threshold for v0.1

≥18/20 binary checks pass; tone rubric ≥4.0 mean across all 20.
