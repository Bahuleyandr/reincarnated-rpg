-- Foreshadowing memory plants (Phase 4.5 Day 16). Significant
-- events plant an "echo" memory tagged to surface a few turns
-- later as a hint, then become a normal retrievable memory once
-- the surface_after_turn threshold is reached.
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS surface_after_turn integer,
  ADD COLUMN IF NOT EXISTS echo_hint text;

-- surface_after_turn:
--   NULL    — ordinary memory; surfaces immediately by similarity.
--   integer — this is an echo; until projection.turn >= this value
--             retrieval surfaces only the echo_hint string.

CREATE INDEX IF NOT EXISTS memories_session_surface_idx
  ON memories (session_id, surface_after_turn)
  WHERE surface_after_turn IS NOT NULL;
