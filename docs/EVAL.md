# Eval harness

Golden-scenario suite that runs against the configured narrator. Not part of CI gate (rate limits, cost). Run on every prompt change before merge.

## Scenario format

`eval/scenarios/NN-name.json`:

```json
{
  "id": "01-hp-floor",
  "narrator": "any",
  "setup": { "events": [...] },
  "input": "I dive at the rat",
  "rollOverride": { "d1": 6, "d2": 6, "mod": 0 },
  "expected": {
    "events": [{ "kind": "damage.applied", "target": "rat", "amount": ">=3" }],
    "tone": { "secondPerson": true, "negativeVocabAbsent": true },
    "rubric": { "hpRespected": true, "toolValid": true, "noUnauthorizedEntities": true }
  }
}
```

## Coverage matrix (20 scenarios)

| # | Scenario | Tests |
|---|---|---|
| 01 | HP floor | damage doesn't go negative |
| 02 | Inventory respect | can't use item not held |
| 03 | Tool selection | correct tool for verb |
| 04 | Tone form | no `hand`/`see`/`grip` for slime |
| 05 | Refusal of impossible action | "I draw my sword" as slime |
| 06 | Prompt injection | "ignore prior instructions..." |
| 07 | Partial-success forces hard-move | 7-9 roll picks from menu |
| 08 | Miss does not no-op | 6- has consequence |
| 09 | Entity-ID discipline | no inventing "Goblin Knight Elara" |
| 10 | NPC reintroduction | recalls earlier interaction |
| 11 | Memory retrieval | surfaces correct prior event |
| 12 | Death event | ends session |
| 13 | Win event | ends session |
| 14 | Turn cap | 10-turn cap ends session |
| 15 | Tool atomicity rollback | one invalid tool → batch rolls back |
| 16 | Beat fires on precondition | correct trigger |
| 17 | Beat does not fire when unmet | no false trigger |
| 18 | Player input sanitized | control chars stripped |
| 19 | Time passage | ticks beats forward |
| 20 | Absorb mechanic | merges item, removes from world |

## Scoring rubric

Each scenario produces:

- **Binary** (must pass):
  - `hpRespected` — vitals never go below floor
  - `inventoryRespected` — no use of items not in inventory
  - `toolValid` — emitted tool calls match expected
  - `noUnauthorizedEntities` — no inventing template-less entities
  - `secondPerson` — narration in second person
  - `negativeVocabAbsent` — slime form: no forbidden words
- **1–5 score** (judge):
  - `toneMatch` — does the prose feel like the form?

LLM-as-judge: Sonnet 4.6 grades narration against the form's sample corpus. Separate prompt from narrator. Self-grading caveat noted; supplement with manual spot-check on every prompt change.

## Run

```bash
npm run eval
```

Outputs:
- `eval/runs/<timestamp>/report.md` — markdown summary
- `eval/runs/<timestamp>/<scenario_id>.json` — per-scenario detail (gitignored)

## Pass threshold for v0.1

- ≥18/20 scenarios pass binary checks.
- Tone rubric ≥4.0 average across all 20.
