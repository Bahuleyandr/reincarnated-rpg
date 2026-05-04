-- Public world-lore delay (Phase 4.5 Day 15). Lore entries written
-- by run-end / admin land in world_lore immediately, but they don't
-- appear on the public /lore page until 24h after creation. The
-- delay is the feature: players see their influence land the next
-- day, and admins have a window to redact griefing content before
-- it goes public.
--
-- We compute "public_at" inline in queries (created_at + interval
-- '24 hours') rather than via a GENERATED STORED column — Postgres
-- rejects interval-based generated columns as non-immutable. The
-- index below covers the common query "non-redacted by created_at",
-- and the inline arithmetic is cheap.
ALTER TABLE world_lore
  ADD COLUMN IF NOT EXISTS admin_redacted boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS world_lore_public_idx
  ON world_lore (created_at DESC)
  WHERE NOT admin_redacted;
