# Architecture

Skeleton — flesh out as M1 days complete.

## Per-turn flow

```
1. Player POSTs action to /api/turn
2. Auth: verify signed cookie -> session_id
3. Load projection at HEAD (cached snapshot + delta replay)
4. Sanitize player input; store raw + rendered separately
5. Classifier (Haiku 4.5): { verb (from form whitelist), confidence, entities }
6. Roll engine: 2d6 + form-stat mod, seeded PRNG (seed stored in event)
7. Retrieve memories: top-k by cosine similarity * entity-overlap * recency
8. Narrator (Sonnet 4.6 OR TemplateNarrator): receives projection + roll + memories + form-card
   -> returns { prose, tool_calls[] }
9. Validate every tool call against rules engine (Zod + form whitelist + state preconditions)
10. Atomicity: ALL tools in this response succeed-or-rollback as one event batch
    - If any tool fails validation: emit `tool_validation_failed` event, re-prompt model with error, max 1 retry
11. Append events: turn.begun, intent.classified, roll.resolved, [tool events...], narration.emitted
12. Write projection snapshot at new seq
13. Return { narration, projection, status } to client
```

## Two principles enforce truth

- **Backend owns state.** The model never mutates anything. It calls validated tools or it narrates only.
- **Event log is append-only.** A Postgres rule blocks DELETE/UPDATE on `events`. Replay-from-zero remains possible always; snapshots are a cache, not the truth.

## Projection strategy: snapshot + delta

Write to `projections` after every successful turn (`up_to_seq = max(events.seq)`). Read path: load snapshot, replay any events with `seq > up_to_seq`. Cold reads or schema bumps replay from zero. Determinism preserved; hot reads O(1).

## Tool-call atomicity

All tools in a single model response succeed-or-rollback as one event batch. The orchestrator wraps the tool batch in a single Postgres transaction. If any tool fails Zod or precondition validation:

1. Roll back the transaction.
2. Emit `tool_validation_failed { tool, error }` event.
3. Re-prompt the model with the error message and a reminder of valid tools. Max 1 retry.
4. If the retry still fails, fall back to `narrate_only` and append `tool_validation_failed` to the log. The session continues.

## Prompt-injection mitigation

Player input enters the event store and re-feeds the model on retrieval. Defenses:

- `sanitize.ts` strips control characters, normalizes Unicode, caps length at 500 chars before storing as `inputSanitized`.
- All retrieved player text is wrapped in delimited untrusted-content blocks: `<player_input>…</player_input>` with explicit guidance in the system prompt.
- The narrator system prompt asserts identity at every turn (not just session start).
- Event store records both `input` (raw) and `inputSanitized` (the version replayed to the model).

## Memory: two tiers

- **Canonical** (`entities` table): NPCs, locations, items, factions referenced by ID. New entities introduced mid-narration are persisted in the same transaction.
- **Episodic** (`memories` table with pgvector): event summaries with embeddings. Per-turn retrieval = similarity × entity-overlap × recency decay.

## Cost tiering

| Step | Model | Per turn |
|---|---|---|
| Action classification | Haiku 4.5 | ~$0.0005 |
| Tone drift check | Haiku 4.5 | ~$0.0005 |
| Memory ranking | voyage-3-lite | ~$0.0001 |
| Narration | Sonnet 4.6 | ~$0.008 |
| **Total** | | **<$0.01** |

Session summary: Sonnet 4.6, once at session end.
