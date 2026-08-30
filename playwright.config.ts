import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.WRITER_STUDIO_UI_BASE_URL;

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: "line",
  use: {
    baseURL: externalBaseUrl ?? "http://127.0.0.1:3102",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseUrl ? undefined : {
    command: "npm run dev:test",
    url: "http://127.0.0.1:3102/api/database/status",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      WRITER_STUDIO_DB_PATH: ".test-data/playwright-direct.sqlite",
      WRITER_STUDIO_TEST_MODE: "1",
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-webkit-swipe",
      grep: /mobile outline swipe archives and restores without opening the more menu/,
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-webkit-keyboard",
      grep: /mobile full outline editor keeps the caret above a visual-viewport keyboard/,
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
