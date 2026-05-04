-- In-run companions (Roadmap item 64).
--
-- Bonded NPCs (world_npcs.bonded_at IS NOT NULL) can be summoned
-- into the active session. Each summoned companion has its own
-- per-run vitals — they level up on session.ended (won) and die
-- on HP→0. Death is permanent: world_npcs.last_seen_status flips
-- to 'dead', and the bond is preserved (the NPC doesn't return
-- in future runs unless the bond was reformed).

CREATE TABLE IF NOT EXISTS session_companions (
  session_id        UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  world_npc_id      UUID NOT NULL REFERENCES world_npcs(id) ON DELETE CASCADE,
  -- Slug + display copied at summon time so the play UI doesn't
  -- need a join.
  slug              TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  level             INTEGER NOT NULL DEFAULT 1,
  current_hp        INTEGER NOT NULL,
  max_hp            INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'alive',  -- alive | dead | left
  joined_at_turn    INTEGER NOT NULL,
  joined_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at          TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (session_id, world_npc_id)
);

CREATE INDEX IF NOT EXISTS session_companions_session_idx
  ON session_companions (session_id);
CREATE INDEX IF NOT EXISTS session_companions_status_idx
  ON session_companions (status);
