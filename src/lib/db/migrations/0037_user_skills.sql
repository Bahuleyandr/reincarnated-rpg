-- Phase 5 Day 23-24: Skills + XP + NPC trainers.
--
-- Skills are USER-LEVEL (cross-run): a slime that learned smithing
-- keeps it after reincarnation. Lore-justified: the soul remembers
-- craft just like it remembers scars (legacy traits).
--
-- One row per (user_id, skill_id). Created on `learn_skill_from(npcId)`
-- with level=1. XP accrues on craft/gather events; level recomputes
-- via floor(sqrt(xp/50)) — see lib/economy/skills.ts.

CREATE TABLE IF NOT EXISTS user_skills (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  xp integer NOT NULL DEFAULT 0,
  learned_at timestamptz NOT NULL DEFAULT now(),
  learned_from_npc_id text,
  UNIQUE (user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS user_skills_user_idx ON user_skills (user_id);
