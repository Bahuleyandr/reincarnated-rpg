ALTER TABLE meta_arcs
  ADD COLUMN IF NOT EXISTS hp integer,
  ADD COLUMN IF NOT EXISTS hp_max integer NOT NULL DEFAULT 1000;

-- Backfill: existing arcs get hp_max=1000, hp inverted from progress.
-- Progress runs 0..1000 from "stirring" toward "broken"; HP runs the
-- other way — 1000 (full) at progress=0, dropping toward 0 as the
-- world's contributions accrete.
UPDATE meta_arcs
   SET hp = GREATEST(0, hp_max - COALESCE(progress, 0))
 WHERE hp IS NULL;

-- Now make hp NOT NULL.
ALTER TABLE meta_arcs ALTER COLUMN hp SET NOT NULL;
