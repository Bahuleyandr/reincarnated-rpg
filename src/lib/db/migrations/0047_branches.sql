-- Phase 7 Day 44: branch decisions.
--
-- 10 major branch decisions across the year (one per ~5 chapters,
-- per docs/STORY_BIBLE.md). Each branch has 2-4 paths; the path
-- with the highest contribution metric at chapter-advance time
-- wins. The resolved path becomes part of persistent world state
-- and the next chapter's narrator fragment can reference it.

CREATE TABLE IF NOT EXISTS branch_decisions (
  id integer PRIMARY KEY,
  chapter_id integer NOT NULL,
  question text NOT NULL,
  paths jsonb NOT NULL,
  resolved_path text,
  resolved_at timestamptz,
  resolution_data jsonb
);

CREATE INDEX IF NOT EXISTS branch_decisions_chapter_idx
  ON branch_decisions (chapter_id);
