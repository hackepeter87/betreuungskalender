import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `https://127.0.0.1:${port}`;
// Workers inherit one run-scoped certificate; Chromium pins only this test key.
let tlsDirectory = process.env.E2E_TLS_DIRECTORY;
if (!tlsDirectory) {
  const directory = mkdtempSync(join(tmpdir(), "betreuungskalender-e2e-tls-"));
  process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-keyout", join(directory, "key.pem"),
    "-out", join(directory, "cert.pem")
  ], { stdio: "ignore" });
  tlsDirectory = process.env.E2E_TLS_DIRECTORY = directory;
}
const certificate = new X509Certificate(readFileSync(join(tlsDirectory, "cert.pem")));
const publicKey = certificate.publicKey.export({ type: "spki", format: "der" });
const certificatePin = createHash("sha256").update(publicKey).digest("base64");
const chromiumLaunchOptions = { args: [`--ignore-certificate-errors-spki-list=${certificatePin}`] };
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
    ignoreHTTPSErrors: true,
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: process.env.CI
      ? "node scripts/e2e-server.mjs"
      : "NODE_ENV=production npm run build && node scripts/e2e-server.mjs",
    url: `${baseURL}/api/ready`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HOST: "127.0.0.1",
      E2E_TLS_DIRECTORY: tlsDirectory,
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
      testMatch: [/desktop\.spec\.ts/, /tablet-layout\.spec\.ts/, /accessibility\.spec\.ts/, /appearance\.spec\.ts/, /external-calendar\.spec\.ts/, /workspace-permissions\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumLaunchOptions,
        viewport: { width: 1440, height: 900 }
      }
    },
    {
      name: "iphone",
      testMatch: [/iphone\.spec\.ts/, /accessibility\.spec\.ts/, /appearance\.spec\.ts/, /external-calendar\.spec\.ts/, /workspace-permissions\.spec\.ts/],
      use: {
        ...devices["iPhone 15"],
        launchOptions: chromiumLaunchOptions,
        browserName: "chromium"
      }
    },
    {
      name: "ipad",
      testMatch: [/ipad\.spec\.ts/, /accessibility\.spec\.ts/, /appearance\.spec\.ts/, /external-calendar\.spec\.ts/, /workspace-permissions\.spec\.ts/],
      use: {
        ...devices["iPad Pro 11"],
        launchOptions: chromiumLaunchOptions,
        browserName: "chromium"
      }
    },
    ...["iPhone 15", "iPad Pro 11"].map(device => ({
      name: device === "iPhone 15" ? "appearance-webkit-iphone" : "appearance-webkit-ipad",
      testMatch: device === "iPad Pro 11" ? [/appearance\.spec\.ts/, /tablet-layout\.spec\.ts/] : /appearance\.spec\.ts/,
      use: {
        ...devices[device],
        browserName: "webkit" as const,
        locale: "de-DE",
        timezoneId: "Europe/Berlin"
      }
    })),
    ...visualViewports.map(({ name, width, height }) => ({
      name,
      testMatch: [/visual-regression\.spec\.ts/, /appearance\.spec\.ts/],
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
