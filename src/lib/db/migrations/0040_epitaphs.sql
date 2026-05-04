-- Phase 5.5 Day 30: Custom epitaphs.
--
-- Players write a 280-char last-words on death; the entry lands in
-- world_lore with category='epitaph' and source_location_id pointing
-- at the death location. Future players passing through the same
-- location see the epitaph 24h later (the public-lore delay).
--
-- world_lore already has source_location_id; this migration adds an
-- index optimized for "recent epitaphs at <locationId>" queries
-- (used by the next-campaign turn-1 memory injection).

CREATE INDEX IF NOT EXISTS world_lore_location_category_idx
  ON world_lore (source_location_id, category, created_at DESC)
  WHERE source_location_id IS NOT NULL AND category = 'epitaph';
