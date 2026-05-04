ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pinned_title text;

-- pinned_title is a slug from content/achievements.json
-- (achievement.titleAwarded). The /api/settings/title endpoint
-- validates the player has actually unlocked the title before
-- allowing the pin. Null = no title pinned.
