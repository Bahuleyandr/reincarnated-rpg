/**
 * World calendar — Phase 7 Day 38.
 *
 * Single-row world_calendar tracks the live chapter (1..48 across
 * a 12-Book × 4-chapter year). Roll-over is driven by the
 * `advanceCalendar` job: every hour, check whether
 * chapter_started_at is >= chapterDurationMs ago. Default duration
 * is 7 real days; tests + sandbox preview accelerate via
 * STORY_TIME_FACTOR (env var).
 *
 * Chapter content is loaded lazily from
 * `content/story/chapters/<n>.json`. Missing chapters fall back to
 * a NEUTRAL placeholder so the system stays running while content
 * is authored on the rolling-week cadence.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";

import type { Db } from "../db/client";
import { worldCalendar, type WorldCalendar } from "../db/schema";

export interface ChapterContent {
  chapterId: number;
  book: number;
  chapterInBook: number;
  weekStart: string;
  weekEnd: string;
  title: string;
  theme: string;
  worldEvent: string;
  narratorPromptFragment: string;
  factionAlignmentBonuses: Record<string, number>;
  locationsAffected: string[];
}

const CHAPTERS_PER_YEAR = 48;
const DEFAULT_CHAPTER_MS = 7 * 24 * 60 * 60 * 1000;

const NEUTRAL: ChapterContent = {
  chapterId: 0,
  book: 0,
  chapterInBook: 0,
  weekStart: "—",
  weekEnd: "—",
  title: "An Unauthored Quiet",
  theme: "the world holds its breath; nothing is named yet",
  worldEvent: "no event of note",
  narratorPromptFragment: "",
  factionAlignmentBonuses: {},
  locationsAffected: [],
};

const cache = new Map<number, ChapterContent | null>();

export function loadChapter(chapterId: number): ChapterContent {
  if (chapterId <= 0) return NEUTRAL;
  if (cache.has(chapterId)) {
    return cache.get(chapterId) ?? NEUTRAL;
  }
  const path = join(
    process.cwd(),
    "content",
    "story",
    "chapters",
    `${chapterId}.json`,
  );
  if (!existsSync(path)) {
    cache.set(chapterId, null);
    return NEUTRAL;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<ChapterContent> & {
      _meta?: unknown;
    };
    const normalized: ChapterContent = {
      chapterId: raw.chapterId ?? chapterId,
      book: raw.book ?? Math.ceil(chapterId / 4),
      chapterInBook: raw.chapterInBook ?? ((chapterId - 1) % 4) + 1,
      weekStart: raw.weekStart ?? "",
      weekEnd: raw.weekEnd ?? "",
      title: raw.title ?? "Untitled",
      theme: raw.theme ?? "",
      worldEvent: raw.worldEvent ?? "",
      narratorPromptFragment: raw.narratorPromptFragment ?? "",
      factionAlignmentBonuses: raw.factionAlignmentBonuses ?? {},
      locationsAffected: raw.locationsAffected ?? [],
    };
    cache.set(chapterId, normalized);
    return normalized;
  } catch {
    cache.set(chapterId, null);
    return NEUTRAL;
  }
}

/** For tests. */
export function clearChapterCache(): void {
  cache.clear();
}

export function chapterDurationMs(): number {
  const factor = Number.parseFloat(process.env.STORY_TIME_FACTOR ?? "1") || 1;
  return Math.max(1000, DEFAULT_CHAPTER_MS / factor);
}

export interface CalendarSnapshot {
  row: WorldCalendar;
  chapter: ChapterContent;
  /** ms remaining until next chapter advance. Negative when overdue. */
  nextAdvanceInMs: number;
}

export async function getCalendar(db: Db): Promise<CalendarSnapshot> {
  const [row] = await db
    .select()
    .from(worldCalendar)
    .where(eq(worldCalendar.id, 1))
    .limit(1);
  if (!row) {
    // Defensive — the migration insert should have placed one row.
    return {
      row: {
        id: 1,
        currentBook: 1,
        currentChapter: 1,
        chapterStartedAt: new Date(),
        year: 1,
      },
      chapter: loadChapter(1),
      nextAdvanceInMs: chapterDurationMs(),
    };
  }
  const chapter = loadChapter(row.currentChapter);
  const elapsed = Date.now() - row.chapterStartedAt.getTime();
  return {
    row,
    chapter,
    nextAdvanceInMs: chapterDurationMs() - elapsed,
  };
}

/**
 * Pure: compute the next (book, chapter) given the current pair.
 * 4 chapters per book, 12 books per year. Wraps to year+1 at the
 * 49th chapter.
 */
export function nextChapterCoords(args: {
  book: number;
  chapter: number;
  year: number;
}): { book: number; chapter: number; chapterInBook: number; year: number; rolledYear: boolean } {
  let { book, chapter, year } = args;
  chapter += 1;
  let rolledYear = false;
  if (chapter > CHAPTERS_PER_YEAR) {
    chapter = 1;
    book = 1;
    year += 1;
    rolledYear = true;
  } else {
    book = Math.ceil(chapter / 4);
  }
  const chapterInBook = ((chapter - 1) % 4) + 1;
  return { book, chapter, chapterInBook, year, rolledYear };
}

export const STORY_CALENDAR_CONSTS = {
  CHAPTERS_PER_YEAR,
};
