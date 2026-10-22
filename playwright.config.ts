import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const base = process.env.PLAYWRIGHT_TEST_ORIGIN ?? "http://127.0.0.1:3010";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
    headless: true,
  },
  webServer:
    process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1"
      ? undefined
      : {
          command: "node dist/apps/server/src/index.js",
          url: `${base}/api/v1/health`,
          timeout: 30000,
          reuseExistingServer: false,
          env: {
            PORT: "3010",
            HOST: new URL(base).hostname,
            MONGODB_URI:
              process.env.MONGODB_TEST_URI ??
              "mongodb://127.0.0.1:27018/questionnaire_test?replicaSet=survey-rs",
            PUBLIC_BASE_URL: base,
            APP_ORIGIN: base,
            COOKIE_SECURE: "false",
          },
        },
});
