-- Ascension — endgame meta-form unlock (post-Phase-8 follow-up).
--
-- Players who complete a threshold of runs can ascend: they
-- unlock an endgame meta-form whose stats inherit from the
-- player's lifetime stats (favored faction skill bonuses,
-- top-3 legacy traits, etc.). One-shot per user; resetting
-- requires admin.

ALTER TABLE users ADD COLUMN IF NOT EXISTS ascended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ascension_form_id text;
-- ascension_seed: snapshot of lifetime metrics at ascension time —
-- drives the meta-form's starter shape. JSON: { totalCampaigns,
-- factionId, dominantSkillId, top3Traits, wyrmCloseEncounters, ... }
ALTER TABLE users ADD COLUMN IF NOT EXISTS ascension_seed jsonb;

CREATE INDEX IF NOT EXISTS users_ascended_idx
  ON users (ascended_at) WHERE ascended_at IS NOT NULL;
