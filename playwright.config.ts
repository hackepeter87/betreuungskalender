import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const visualViewports = [
  { name: "visual-320", width: 320, height: 800 },
  { name: "visual-390", width: 390, height: 844 },
  { name: "visual-768", width: 768, height: 1024 },
  { name: "visual-1280", width: 1280, height: 900 },
  { name: "visual-1440", width: 1440, height: 900 },
  { name: "visual-1920", width: 1920, height: 1080 }
] as const;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "line",
  use: {
    baseURL,
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: process.env.CI
      ? "npm start"
      : "NODE_ENV=production npm run build && npm start",
    url: `${baseURL}/api/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_PATH: "./test-results/e2e.sqlite",
      BACKUP_DIR: "./test-results/backups",
      LEGAL_CONTENT_DIR: "./e2e/fixtures/legal",
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      ALLOWED_ORIGIN: baseURL,
      // E2E scenarios intentionally issue many synthetic API calls from one IP.
      RATE_LIMIT_MAX: "10000",
      RATE_LIMIT_WRITE_MAX: "10000",
      RATE_LIMIT_SENSITIVE_MAX: "10000",
      RATE_LIMIT_EXPORT_MAX: "10000"
    }
  },
  projects: [
    {
      name: "desktop",
      testMatch: [/desktop\.spec\.ts/, /external-calendar\.spec\.ts/, /workspace-permissions\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      name: "iphone",
      testMatch: [/iphone\.spec\.ts/, /external-calendar\.spec\.ts/, /workspace-permissions\.spec\.ts/],
      use: {
        ...devices["iPhone 15"],
        browserName: "chromium"
      }
    },
    {
      name: "ipad",
      testMatch: [/ipad\.spec\.ts/, /external-calendar\.spec\.ts/, /workspace-permissions\.spec\.ts/],
      use: {
        ...devices["iPad Pro 11"],
        browserName: "chromium"
      }
    },
    ...visualViewports.map(({ name, width, height }) => ({
      name,
      testMatch: /visual-regression\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium" as const,
        colorScheme: "light" as const,
        deviceScaleFactor: 1,
        locale: "de-DE",
        reducedMotion: "reduce" as const,
        serviceWorkers: "block" as const,
        timezoneId: "Europe/Berlin",
        viewport: { width, height }
      }
    }))
  ]
});
