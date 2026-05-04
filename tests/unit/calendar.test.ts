import {
  chapterDurationMs,
  clearChapterCache,
  loadChapter,
  nextChapterCoords,
  STORY_CALENDAR_CONSTS,
} from "@/lib/story/calendar";

describe("calendar pure helpers", () => {
  beforeEach(() => clearChapterCache());

  test("loadChapter returns the authored Chapter 1", () => {
    const c = loadChapter(1);
    expect(c.chapterId).toBe(1);
    expect(c.book).toBe(1);
    expect(c.chapterInBook).toBe(1);
    expect(c.title).toMatch(/Strange Omens/);
  });

  test("loadChapter returns the neutral placeholder for missing chapters", () => {
    const c = loadChapter(999);
    expect(c.title).toMatch(/Quiet/);
  });

  test("loadChapter handles 0 / negative", () => {
    expect(loadChapter(0).title).toMatch(/Quiet/);
    expect(loadChapter(-1).title).toMatch(/Quiet/);
  });

  test("nextChapterCoords advances within a book", () => {
    expect(
      nextChapterCoords({ book: 1, chapter: 1, year: 1 }),
    ).toEqual({
      book: 1,
      chapter: 2,
      chapterInBook: 2,
      year: 1,
      rolledYear: false,
    });
  });

  test("nextChapterCoords rolls to next book at the 4-chapter boundary", () => {
    expect(
      nextChapterCoords({ book: 1, chapter: 4, year: 1 }),
    ).toEqual({
      book: 2,
      chapter: 5,
      chapterInBook: 1,
      year: 1,
      rolledYear: false,
    });
  });

  test("nextChapterCoords rolls to year+1 at chapter 49", () => {
    expect(
      nextChapterCoords({ book: 12, chapter: 48, year: 1 }),
    ).toEqual({
      book: 1,
      chapter: 1,
      chapterInBook: 1,
      year: 2,
      rolledYear: true,
    });
  });

  test("CHAPTERS_PER_YEAR is 48", () => {
    expect(STORY_CALENDAR_CONSTS.CHAPTERS_PER_YEAR).toBe(48);
  });

  test("chapterDurationMs respects STORY_TIME_FACTOR env override", () => {
    const orig = process.env.STORY_TIME_FACTOR;
    process.env.STORY_TIME_FACTOR = "168"; // 7 days / 168 = 1 hour
    expect(chapterDurationMs()).toBeLessThan(2 * 60 * 60 * 1000);
    process.env.STORY_TIME_FACTOR = orig;
  });
});
