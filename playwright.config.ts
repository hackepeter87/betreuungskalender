import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

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
    command: process.env.CI ? "npm start" : "npm run build && npm start",
    url: `${baseURL}/api/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_PATH: "./test-results/e2e.sqlite",
      BACKUP_DIR: "./test-results/backups",
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      ALLOWED_ORIGIN: baseURL
    }
  },
  projects: [
    {
      name: "desktop",
      testMatch: /desktop\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      name: "iphone",
      testMatch: /iphone\.spec\.ts/,
      use: {
        ...devices["iPhone 15"],
        browserName: "chromium"
      }
    },
    {
      name: "ipad",
      testMatch: /ipad\.spec\.ts/,
      use: {
        ...devices["iPad Pro 11"],
        browserName: "chromium"
      }
    }
  ]
});
