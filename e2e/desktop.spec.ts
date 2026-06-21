import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  createHoliday,
  navigate,
  openApp,
  resetApp
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("covers the core documentation and export flows", async ({ page }) => {
  const childName = "Alex Beispiel";
  await openApp(page);
  await createChild(page, childName);

  await createEntry(page, {
    childName,
    startDay: 8,
    startTime: "09:00",
    endDay: 8,
    endTime: "15:00",
    note: "Fiktiver regulärer Betreuungseintrag"
  });
  await createEntry(page, {
    childName,
    startDay: 10,
    startTime: "15:00",
    endDay: 10,
    endTime: "17:00",
    note: "Fiktive stundenweise Betreuung",
    withTripAndCost: true
  });
  await createEntry(page, {
    childName,
    startDay: 12,
    startTime: "17:00",
    endDay: 13,
    endTime: "08:00",
    note: "Fiktive Übernachtungsbetreuung",
    overnight: true
  });

  await navigate(page, "entries");
  await expect(page.getByText(childName).first()).toBeVisible();
  await createHoliday(page, childName);

  await navigate(page, "report");
  await expect(page.getByTestId("page-report")).toBeVisible();
  await expect(page.getByText(childName).first()).toBeVisible();
  await expect(page.locator('[data-testid="report-entry-trip-km"][data-value="18.5"]'))
    .toBeVisible();
  await expect(page.locator('[data-testid="report-entry-cost"][data-value="12.4"]'))
    .toBeVisible();

  await navigate(page, "backup");
  await expect(page.getByTestId("page-backup")).toBeVisible();
  await expect(page.getByTestId("csv-export-panel")).toBeVisible();
  await expect(page.getByTestId("export-entries-csv")).toBeVisible();
});

test("switches to read-only mode when the API is unavailable", async ({
  context,
  page
}) => {
  await openApp(page);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  const banner = page.getByTestId("offline-banner");
  await expect(banner).toHaveAttribute("data-state", "readonly");
  await expect(page.getByTestId("dashboard-new-entry")).toBeDisabled();
  await expect(page.getByTestId("dashboard-close-month")).toBeDisabled();

  const cachedApiRequests = await page.evaluate(async () => {
    const cacheNames = await caches.keys();
    const requests = (
      await Promise.all(
        cacheNames.map(async (cacheName) => {
          const cache = await caches.open(cacheName);
          return cache.keys();
        })
      )
    ).flat();
    return requests
      .map((request) => new URL(request.url).pathname)
      .filter((path) => path.startsWith("/api/"));
  });
  expect(cachedApiRequests).toEqual([]);

  await context.setOffline(false);
});

test("persists the selected language and localizes the report surface", async ({
  page
}) => {
  await openApp(page);
  await navigate(page, "settings");

  const language = page.getByTestId("settings-language");
  await language.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("nav-report")).toContainText("Report");

  await navigate(page, "report");
  await expect(page.getByTestId("report-title")).toHaveText(
    "Report on documented care periods"
  );

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await navigate(page, "settings");
  await expect(page.getByTestId("settings-language")).toHaveValue("en");
});
