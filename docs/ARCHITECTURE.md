# Architecture

## Per-turn flow

```
 1. Player POSTs action to /api/turn (or /api/turn/stream)
 2. Auth: verify signed cookie -> session_id
 3. Moderation gate (cheap, deterministic; lib/moderation):
    - injection patterns -> 400 reject (no energy spent)
    - severe profanity   -> 422 reject + bad_luck stack (energy spent)
    - mild profanity     -> proceed; bad_luck stack queued
 4. Acquire turn-lock (token + 90s expiry on sessions row).
    Concurrent POSTs see the lock and 409 with currentLockExpiresAtMs
    so the UI can show "settling..." + auto-retry.
    (See ADR-020 + lib/game/turn-lock.)
 5. Energy gate (lib/energy/state.trySpend with advisory lock).
    Out of energy -> 429 with the post-refill view.
 6. Load projection at HEAD (cached snapshot + delta replay)
 7. Sanitize player input; store raw + rendered separately
 8. Classifier (regex; or Haiku 4.5 if user opted in): { verb, confidence }
 9. Roll engine: 2d6 + form-stat mod − bad_luck penalty, seeded PRNG
10. Retrieve memories: top-k cosine × entity-overlap × recency decay
11. Narrator (Sonnet 4.6 OR TemplateNarrator): receives projection + roll
    + memories + form-card -> returns { prose, tool_calls[] }
12. Speculative event batching (lib/game/turn):
    - validateToolsToEvents() validates the whole tool batch + builds
      pendingEvents in-memory (no DB writes).
    - If validation fails: emit tool_validation_failed, re-prompt
      narrator with error + form-tone reminder, max 1 retry, then
      fall back to narrate_only.
13. Tone-drift check on the final accepted text (regex; LLM judge if
    user opted in). One retry on violation.
14. appendEvents in one transaction: turn.begun, intent.classified,
    roll.resolved, [tool events...], narration.emitted.
15. Write projection snapshot at the new seq.
16. Beat matcher fires any qualifying beats; append their events.
17. Return { narration, projection, roll, status } to client.
18. finally { releaseTurnLock(token) } — token-strict release;
    audit row writes regardless of outcome.
```

## Turn-lock primitive (ADR-020)

`sessions.turn_lock_token` + `sessions.turn_lock_expires_at` + an audit log table `turn_lock_events`.

Acquire is atomic: a single guarded UPDATE — `WHERE turn_lock_token IS NULL OR turn_lock_expires_at < now()`. If the row updated, we own the lock.

Release is token-strict — a delayed worker can't release a lock that's been re-acquired by someone else. Returns boolean (true if released, false if the lock was already gone). Either outcome writes an audit row.

Force-release (admin) is exposed at `/api/god/locks` and writes `force_released` audit rows attributed to the actor.

Default TTL 90 seconds. The next acquire on an expired lock auto-reclaims with `claimed_expired` audit kind, so orphaned locks self-heal within ~90s.

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
