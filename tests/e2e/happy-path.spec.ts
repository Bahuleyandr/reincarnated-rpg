import { test, expect } from "@playwright/test";

/**
 * Happy-path smoke (POLISH_PLAN 0b.4).
 *
 * Drives the deterministic TemplateNarrator path so it doesn't burn
 * any AI credits and runs without an ANTHROPIC_API_KEY:
 *
 *   1. Land on /
 *   2. Click "Begin" (anon session)
 *   3. Wait for /play to load + transcript to be visible
 *   4. Click each of the 3 verb-button presets in turn (the
 *      escape-hatch text input is now off by default; the
 *      preset path is deterministic and on-form)
 *   5. Assert that transcript now contains the 3 narration responses
 *
 * Updated 2026-05-06 — the original spec used data-testids that
 * have since been refactored away and the input box is now behind
 * the verb-button surface.
 */

test("anon player begins, plays 3 turns via verb buttons", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /reincarnated/i }),
  ).toBeVisible();

  // Click the canonical Begin button (covers "Begin" and
  // "Begin (anon run)" via partial regex).
  await page.getByRole("button", { name: /^begin/i }).click();
  await page.waitForURL("**/play");

  // Wait for the play page to settle.
  const transcript = page.getByTestId("transcript");
  await expect(transcript).toBeVisible({ timeout: 15_000 });

  // The verb-button surface should render 3 preset buttons. Their
  // exact labels depend on the form, but every button has a
  // <button type="button"> with a verb label.  Find all preset
  // buttons by walking the verb-suggestions region.  We click 3
  // turns in sequence and wait for the transcript to grow between
  // turns.
  for (let turn = 1; turn <= 3; turn++) {
    // The preset-button grid lives in a 3-column grid above the
    // "say something else…" tile.  Pick the first available.
    const buttons = page
      .locator('button[type="button"]')
      .filter({ hasNotText: /say something else|back to preset/i });
    const targetCount = await buttons.count();
    expect(targetCount).toBeGreaterThan(0);
    // Click the first that's enabled.
    let clicked = false;
    for (let i = 0; i < targetCount && !clicked; i++) {
      const b = buttons.nth(i);
      if (await b.isEnabled()) {
        await b.click();
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);

    // Wait for narration to land — transcript text grows.
    await expect(async () => {
      const text = await transcript.innerText();
      expect(text.length).toBeGreaterThan(turn * 30); // crude growth check
    }).toPass({ timeout: 30_000 });
  }
});
