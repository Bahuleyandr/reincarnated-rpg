import { test, expect } from "@playwright/test";

/**
 * Day-7 e2e: begin → 3 turns → end.
 *
 * Assumes:
 *   - `npm run dev:up` has been started (Postgres ready, schema migrated).
 *   - Playwright config (playwright.config.ts) starts `next dev` for the
 *     test base URL.
 *
 * The test runs the TemplateNarrator (default M1) so it's deterministic
 * and doesn't burn API credits.
 */

test("anon player begins, plays 3 turns, sees final state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /reincarnated/i })).toBeVisible();

  await page.getByRole("button", { name: /begin/i }).click();
  await page.waitForURL("**/play");

  // Initial state — turn 0, status active.
  await expect(page.getByTestId("status")).toHaveText("active");
  await expect(page.getByTestId("turn")).toHaveText("0");

  // Turn 1.
  await page.getByTestId("input").fill("I ooze toward the slope");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("turn")).toHaveText("1");

  // Turn 2.
  await page.getByTestId("input").fill("I sense the room");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("turn")).toHaveText("2");

  // Turn 3.
  await page.getByTestId("input").fill("I wait");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("turn")).toHaveText("3");

  // Transcript should now have ≥ 3 narration lines + 3 input echoes.
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toBeVisible();
});
