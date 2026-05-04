-- Companion NPCs (Phase 2 Day 7-8). worldNpcs is already per-user
-- (sees user_id column); we add bonded_at + personality_card to
-- mark and characterize promoted NPCs.
ALTER TABLE world_npcs
  ADD COLUMN IF NOT EXISTS bonded_at timestamptz,
  ADD COLUMN IF NOT EXISTS personality_card jsonb;

-- Partial index makes "fetch this user's bonded companions" cheap.
CREATE INDEX IF NOT EXISTS world_npcs_bonded_idx
  ON world_npcs (user_id, bonded_at DESC)
  WHERE bonded_at IS NOT NULL;
