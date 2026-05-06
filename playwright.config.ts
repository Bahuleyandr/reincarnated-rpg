import { defineConfig, devices } from "@playwright/test";

// POLISH_PLAN 0b.4 — when invoked from `scripts/ci-local.sh`,
// the wrapper boots `next start` itself (so it can override
// DATABASE_URL etc. without Next reading .env.local). In that
// mode it sets PLAYWRIGHT_SKIP_WEBSERVER=1 and supplies the
// running server's URL via PLAYWRIGHT_BASE_URL. Local dev
// invocations (`npm run test:e2e`) keep the auto-launch behavior.
const skipWebServer = !!process.env.PLAYWRIGHT_SKIP_WEBSERVER;
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: "http://127.0.0.1:3000",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }),
});
