-- Backfill the missing DEFAULT on meta_arcs.hp.
--
-- Migration 0031 added the hp column, backfilled it from progress, then
-- flipped it to NOT NULL. It set a DEFAULT on hp_max (1000) but not on hp.
-- The schema (src/lib/db/schema.ts) declares default(1000) on both, so
-- inserts that rely on column defaults — like ensureLongWyrmExists in
-- src/lib/meta/long-wyrm.ts — hit a NOT NULL violation on fresh DBs that
-- ran the migrations from zero.
--
-- This is a CI-only failure mode (existing dev / prod DBs picked up the
-- default through some out-of-band fix). The integration tests caught it
-- once a fresh DB was rebuilt from migrations.

ALTER TABLE meta_arcs ALTER COLUMN hp SET DEFAULT 1000;
