#!/usr/bin/env ts-node
/**
 * scripts/new-chapter.ts — story authoring scaffolder.
 *
 * Phase 7 Day 53. Creates content/story/chapters/<n>.json with
 * the canonical shape filled in (book + chapterInBook computed
 * from the chapter id), so weekly chapter authoring is one
 * command away.
 *
 * Usage:
 *   npx ts-node scripts/new-chapter.ts 5 "The Choristers Wake"
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function main() {
  const [, , chapterArg, ...titleParts] = process.argv;
  const chapterId = Number.parseInt(chapterArg ?? "", 10);
  const title = titleParts.join(" ").trim();
  if (!Number.isInteger(chapterId) || chapterId < 1 || chapterId > 48) {
    console.error("usage: new-chapter <1..48> <title>");
    process.exit(1);
  }
  if (!title) {
    console.error("usage: new-chapter <1..48> <title>");
    process.exit(1);
  }
  const book = Math.ceil(chapterId / 4);
  const chapterInBook = ((chapterId - 1) % 4) + 1;
  const week = chapterId; // 1 chapter = 1 week
  const path = join(
    process.cwd(),
    "content",
    "story",
    "chapters",
    `${chapterId}.json`,
  );
  if (existsSync(path)) {
    console.error(`already exists: ${path}`);
    process.exit(1);
  }
  const content = {
    _meta: {
      license: "CC BY-NC 4.0",
      version: 1,
      authoredOn: new Date().toISOString().slice(0, 10),
      notes: "TODO: author this chapter",
    },
    chapterId,
    book,
    chapterInBook,
    weekStart: `Year 1, Week ${week}`,
    weekEnd: `Year 1, Week ${week}`,
    title,
    theme: "TODO",
    worldEvent: "TODO",
    narratorPromptFragment: `The current world-chapter is BOOK ${book}, CHAPTER ${chapterInBook}: ${title.toUpperCase()}. TODO: author the prompt fragment.`,
    factionAlignmentBonuses: {
      choristers: 1.0,
      rust_hand: 1.0,
      idle: 1.0,
      forsaken: 1.0,
    },
    locationsAffected: [],
  };
  writeFileSync(path, JSON.stringify(content, null, 2) + "\n", "utf-8");
  console.log(`wrote ${path}`);
}

main();
