/**
 * Calendar advance — Phase 7 Day 38.
 *
 * Cron-able job: every hour, check whether the current chapter has
 * been live for >= chapterDurationMs. If yes, atomically roll over
 * to the next chapter, fire a `chapter.advanced` world event, and
 * emit a `world_lore` summary entry tagged with the new chapter.
 *
 * Branch resolution (Day 44) hooks here too: if the outgoing
 * chapter has a branch decision pending, it resolves at the same
 * moment the calendar advances.
 */
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db/client";
import {
  worldCalendar,
  worldEvents,
  worldLore,
} from "../db/schema";
import { invalidatePrefix } from "../util/cache";
import { log } from "../util/log";
import { uuidv7 } from "../util/uuidv7";

import {
  chapterDurationMs,
  getCalendar,
  loadChapter,
  nextChapterCoords,
} from "./calendar";

export interface AdvanceResult {
  advanced: boolean;
  fromChapter: number;
  toChapter: number;
  rolledYear: boolean;
}

export async function advanceCalendar(db: Db): Promise<AdvanceResult> {
  const snap = await getCalendar(db);
  const elapsed = Date.now() - snap.row.chapterStartedAt.getTime();
  if (elapsed < chapterDurationMs()) {
    return {
      advanced: false,
      fromChapter: snap.row.currentChapter,
      toChapter: snap.row.currentChapter,
      rolledYear: false,
    };
  }

  const next = nextChapterCoords({
    book: snap.row.currentBook,
    chapter: snap.row.currentChapter,
    year: snap.row.year,
  });

  await db
    .update(worldCalendar)
    .set({
      currentBook: next.book,
      currentChapter: next.chapter,
      year: next.year,
      chapterStartedAt: new Date(),
    })
    .where(eq(worldCalendar.id, 1));

  const newChapter = loadChapter(next.chapter);

  // World-event audit row.
  await db.insert(worldEvents).values({
    id: uuidv7(),
    kind: "chapter.advanced",
    payload: {
      fromChapter: snap.row.currentChapter,
      toChapter: next.chapter,
      book: next.book,
      year: next.year,
      rolledYear: next.rolledYear,
      title: newChapter.title,
    },
  });

  // World-lore writeback so the public ticker eventually narrates
  // the advance ("Book I, Chapter 2: A Name in the Dust opens.").
  if (newChapter.title) {
    await db.insert(worldLore).values({
      id: uuidv7(),
      summary: `Book ${next.book}, Chapter ${next.chapterInBook} opens: "${newChapter.title}". ${newChapter.theme}.`,
      prose: newChapter.worldEvent,
      salience: 0.85,
      category: "chapter_advance",
      tags: ["chapter_advance", `chapter-${next.chapter}`],
      sourceLocationId: null,
      sourceFormId: null,
      sourcePhase: null,
    });
    invalidatePrefix("lore:");
  }

  log.info("calendar.advanced", {
    fromChapter: snap.row.currentChapter,
    toChapter: next.chapter,
    book: next.book,
    year: next.year,
    rolledYear: next.rolledYear,
  });

  return {
    advanced: true,
    fromChapter: snap.row.currentChapter,
    toChapter: next.chapter,
    rolledYear: next.rolledYear,
  };
}

void sql;
