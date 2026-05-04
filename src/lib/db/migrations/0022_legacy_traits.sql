ALTER TABLE users
  ADD COLUMN IF NOT EXISTS legacy_traits jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Shape: { fire_scarred: 2, water_affinity: 1, whimsical: 1 }
-- Trait keys are stable slugs from content/legacy/traits.json.
-- Values are accumulated counts (each death imprints +1).
