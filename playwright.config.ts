// End-to-end drill (plan.md §11): drives the real PWA in a browser, offline,
// against the built app — not the in-memory fakes the unit tests use.
//
// Locally / in CI: `npm run e2e` builds the app, serves it with `vite preview`,
// and runs the specs against Playwright's managed Chromium (`npx playwright
// install chromium` once). In a sandbox where the browser can't be downloaded,
// set CHROME_BIN to an existing Chromium binary and it is used instead.
import { defineConfig, devices } from "@playwright/test";

const PORT = 4321;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    ...(process.env.CHROME_BIN
      ? { launchOptions: { executablePath: process.env.CHROME_BIN } }
      : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], hasTouch: true } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
