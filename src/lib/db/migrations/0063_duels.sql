-- Phase 9 T5.5 — PvP duels (minimal slice).
--
-- Opt-in 1v1 confrontation. Challenger picks a target user (or
-- recurring NPC by template id); target accepts or refuses.
-- Resolution rolls 2d6 with each side's faction modifier; the
-- winner takes a small reputation bump, the loser takes a small
-- humility bump. No coins move (this isn't a fight ring).
--
-- Resolution logic is OUT OF SCOPE for this migration — we ship
-- the schema + challenge/accept. The /duels page can render the
-- queue; resolution wires up later.

CREATE TABLE IF NOT EXISTS duels (
  id              UUID PRIMARY KEY,
  challenger_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Either target_user_id OR target_npc_template_id; never both.
  target_user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
  target_npc_template_id TEXT,
  -- Status: pending | accepted | refused | resolved | expired.
  status          TEXT NOT NULL DEFAULT 'pending',
  -- Optional context: a faction tag, a quote, the venue ('the-coral-anchorage').
  context_faction TEXT,
  context_venue   TEXT,
  context_quote   TEXT,
  -- Resolution roll (filled in when resolved).
  challenger_roll INTEGER,
  target_roll     INTEGER,
  winner_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Audit timestamps.
  challenged_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  decided_at      TIMESTAMP WITH TIME ZONE,
  resolved_at     TIMESTAMP WITH TIME ZONE,
  expires_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  CHECK (
    (target_user_id IS NOT NULL AND target_npc_template_id IS NULL) OR
    (target_user_id IS NULL AND target_npc_template_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS duels_challenger_idx
  ON duels (challenger_user_id, status);
CREATE INDEX IF NOT EXISTS duels_target_idx
  ON duels (target_user_id, status);
CREATE INDEX IF NOT EXISTS duels_status_idx
  ON duels (status, expires_at);
