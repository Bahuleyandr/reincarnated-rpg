/**
 * Skills + XP — Phase 5 Day 23-24.
 *
 * The catalog (content/skills.json) defines 7 skills, each gated by
 * a trainer NPC. The XP curve is `level = floor(sqrt(xp / 50))` —
 * casual play reaches L5 in a long session, L10 in a week, L20 is a
 * brag. The curve is square-root-flat so the gradient stays
 * meaningful even into late-game.
 *
 * Skills live in the `user_skills` table, one row per (userId,
 * skillId) pair. UNIQUE constraint makes `learn_skill_from` idempotent
 * (a duplicate learn returns the existing row, not an error).
 *
 * XP awards (`awardXp`) bump xp + recompute level. When a level
 * crosses, callers receive a `leveledUp: true` flag so they can emit
 * a `skill.leveled_up` event.
 */
import { eq, and } from "drizzle-orm";

import skillsData from "../../../content/skills.json";

import type { Db } from "../db/client";
import { userSkills } from "../db/schema";
import { uuidv7 } from "../util/uuidv7";

export interface Skill {
  id: string;
  label: string;
  description: string;
  trainerNpcId: string;
}

interface RawSkill {
  id?: unknown;
  label?: unknown;
  description?: unknown;
  trainerNpcId?: unknown;
}

interface RawCatalog {
  skills: RawSkill[];
}

function normalize(raw: RawSkill): Skill | null {
  if (
    typeof raw.id !== "string" ||
    typeof raw.label !== "string" ||
    typeof raw.description !== "string" ||
    typeof raw.trainerNpcId !== "string"
  ) {
    return null;
  }
  return {
    id: raw.id,
    label: raw.label,
    description: raw.description,
    trainerNpcId: raw.trainerNpcId,
  };
}

const CATALOG: ReadonlyArray<Skill> = (skillsData as unknown as RawCatalog).skills
  .map(normalize)
  .filter((s): s is Skill => s !== null);

const BY_ID = new Map<string, Skill>(CATALOG.map((s) => [s.id, s]));

export function listSkills(): readonly Skill[] {
  return CATALOG;
}

export function getSkill(id: string): Skill | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Pure: convert XP to level. `level = floor(sqrt(xp / 50))`. Capped
 * at 30 (matches POST_MVP_PLAN's "level 20 is a brag" guidance,
 * leaving headroom for end-game expansion).
 */
export function xpToLevel(xp: number): number {
  if (xp <= 0) return 0;
  const lvl = Math.floor(Math.sqrt(xp / 50));
  return Math.min(30, Math.max(0, lvl));
}

/** Inverse of xpToLevel — total XP needed to reach the given level. */
export function xpForLevel(level: number): number {
  return Math.max(0, Math.floor(level * level * 50));
}

export interface UserSkillRow {
  skillId: string;
  level: number;
  xp: number;
  learnedAt: Date;
  learnedFromNpcId: string | null;
}

export async function listUserSkills(
  db: Db,
  userId: string,
): Promise<UserSkillRow[]> {
  const rows = await db
    .select({
      skillId: userSkills.skillId,
      level: userSkills.level,
      xp: userSkills.xp,
      learnedAt: userSkills.learnedAt,
      learnedFromNpcId: userSkills.learnedFromNpcId,
    })
    .from(userSkills)
    .where(eq(userSkills.userId, userId));
  return rows.map((r) => ({
    skillId: r.skillId,
    level: r.level,
    xp: r.xp,
    learnedAt: r.learnedAt,
    learnedFromNpcId: r.learnedFromNpcId,
  }));
}

export async function getUserSkill(
  db: Db,
  userId: string,
  skillId: string,
): Promise<UserSkillRow | null> {
  const [row] = await db
    .select()
    .from(userSkills)
    .where(and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)))
    .limit(1);
  if (!row) return null;
  return {
    skillId: row.skillId,
    level: row.level,
    xp: row.xp,
    learnedAt: row.learnedAt,
    learnedFromNpcId: row.learnedFromNpcId,
  };
}

export interface LearnResult {
  /** Newly created (true) or already known (false). */
  newlyLearned: boolean;
  skillId: string;
}

export async function learnSkill(
  db: Db,
  userId: string,
  skillId: string,
  fromNpcId: string,
): Promise<LearnResult> {
  if (!getSkill(skillId)) throw new Error(`unknown skill: ${skillId}`);
  const existing = await getUserSkill(db, userId, skillId);
  if (existing) return { newlyLearned: false, skillId };
  await db.insert(userSkills).values({
    id: uuidv7(),
    userId,
    skillId,
    level: 1,
    xp: 0,
    learnedFromNpcId: fromNpcId,
  });
  return { newlyLearned: true, skillId };
}

export interface AwardXpResult {
  xp: number;
  level: number;
  /** True when this award crossed at least one level threshold. */
  leveledUp: boolean;
  previousLevel: number;
}

/**
 * Atomic xp bump. If the player doesn't know the skill, this is a
 * no-op (returns null) — the caller is expected to surface "you must
 * find a trainer" via the recipe validator.
 */
export async function awardXp(
  db: Db,
  userId: string,
  skillId: string,
  amount: number,
): Promise<AwardXpResult | null> {
  if (amount <= 0) return null;
  const existing = await getUserSkill(db, userId, skillId);
  if (!existing) return null;
  const nextXp = existing.xp + amount;
  const previousLevel = existing.level;
  const nextLevel = Math.max(previousLevel, xpToLevel(nextXp));
  await db
    .update(userSkills)
    .set({ xp: nextXp, level: nextLevel })
    .where(
      and(eq(userSkills.userId, userId), eq(userSkills.skillId, skillId)),
    );
  return {
    xp: nextXp,
    level: nextLevel,
    leveledUp: nextLevel > previousLevel,
    previousLevel,
  };
}
