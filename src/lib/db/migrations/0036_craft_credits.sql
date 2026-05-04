-- Phase 5 Day 20: Craft credits — 0.1-energy crafting via integer pool.
--
-- Energy stays an integer (don't break the existing system). The
-- craft_credits column holds an 0..10 pool: each craft / gather /
-- smelt / smith action decrements it; when it hits 0, the next
-- action consumes 1 energy and refills the pool. Net effect: every
-- 10 craft actions cost 1 energy, but the player feels the spend
-- as a smooth gradient instead of a hard 1-energy gate per action.
--
-- The pool is per-account (users.craft_credits) for logged-in
-- players and per-session (sessions.craft_credits) for anon — same
-- shape as coins.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS craft_credits integer NOT NULL DEFAULT 10;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS craft_credits integer NOT NULL DEFAULT 10;

ALTER TABLE users
  ADD CONSTRAINT users_craft_credits_range_chk CHECK (craft_credits >= 0 AND craft_credits <= 10);
ALTER TABLE sessions
  ADD CONSTRAINT sessions_craft_credits_range_chk CHECK (craft_credits >= 0 AND craft_credits <= 10);
