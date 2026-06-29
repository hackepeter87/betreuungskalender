import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  createHoliday,
  importExternalCalendar,
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

test("shows calendar overlays in the dashboard overview", async ({
  page,
  request
}) => {
  await openApp(page);
  await importExternalCalendar(page, "Synthetic Dashboard Calendar");

  const unavailableResponse = await request.post("/api/unavailable-periods", {
    data: {
      startDateTime: "2026-07-02T08:00:00.000Z",
      endDateTime: "2026-07-02T18:00:00.000Z",
      category: "duty",
      dutyRelated: true,
      affectsContact: true,
      affectsHolidays: false,
      location: "Synthetic service location",
      notes: "Synthetic documented unavailability",
      hasEvidence: false
    }
  });
  expect(unavailableResponse.ok()).toBeTruthy();
  const unavailable = await unavailableResponse.json() as { id: string };

  const eventsResponse = await request.get(
    "/api/external-calendar-events?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z"
  );
  expect(eventsResponse.ok()).toBeTruthy();
  const [event] = await eventsResponse.json() as Array<{ id: string }>;

  await page.reload();
  await expect(page.getByTestId("app-loading")).toBeHidden();
  await navigate(page, "dashboard");
  await page.getByTestId("month-picker").fill("2026-07");
  const dashboardCalendar = page.locator(".calendar-panel");
  await expect(dashboardCalendar.getByTestId(`external-calendar-event-${event?.id}`))
    .toHaveCount(3);
  await expect(dashboardCalendar.getByTestId(`calendar-unavailable-${unavailable.id}`))
    .toBeVisible();
});

test("explains empty entries caused by the selected month", async ({ page }) => {
  const childName = "Monatsliste Kind";
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const emptyMonth = [
    nextMonth.getFullYear(),
    String(nextMonth.getMonth() + 1).padStart(2, "0")
  ].join("-");
  await openApp(page);
  await createChild(page, childName);
  await createEntry(page, {
    childName,
    startDay: 8,
    startTime: "09:00",
    endDay: 8,
    endTime: "15:00",
    note: "Fiktiver Eintrag für die Monatsliste"
  });

  await navigate(page, "entries");
  await page.getByTestId("month-picker").fill(emptyMonth);
  const emptyState = page.getByTestId("entries-empty-state");
  await expect(emptyState).toBeVisible();
  await expect(emptyState).toContainText("Keine Einträge im ausgewählten Monat");
});

test("generates recurring weekend contact dates and shows them in the calendar", async ({
  page,
  request
}) => {
  const childName = "Rhythmus Kind";
  await openApp(page);
  await createChild(page, childName);

  await navigate(page, "contact");
  await expect(page.getByTestId("page-contact")).toBeVisible();
  await page.getByTestId("contact-pattern-start-date").fill("2026-07-03");
  await page.getByTestId("contact-pattern-friday-start-time").fill("16:00");
  await page.getByTestId("contact-pattern-sunday-end-time").fill("18:00");
  await page.getByTestId("contact-generation-start").fill("2026-07-01");
  await page.getByTestId("contact-generation-end").fill("2026-07-31");
  await expect(page.getByTestId("contact-generation-preview")).toContainText(
    "3 neue geplante Termine"
  );

  await page.getByTestId("contact-pattern-save").click();
  await expect(page.getByTestId("contact-message")).toContainText(
    "Umgangsregel gespeichert"
  );
  await page.getByTestId("contact-generate").click();
  await expect(page.getByTestId("contact-message")).toContainText(
    "3 geplante Umgangstermine"
  );
  await expect(page.getByTestId("contact-generated-entry")).toHaveCount(3);

  const entriesResponse = await request.get("/api/care-entries");
  expect(entriesResponse.ok()).toBeTruthy();
  const generatedEntries = (await entriesResponse.json() as Array<{
    id: string;
    generatedByPatternId?: string;
    status: string;
  }>).filter((entry) => entry.generatedByPatternId);
  expect(generatedEntries).toHaveLength(3);
  expect(generatedEntries.every((entry) => entry.status === "planned")).toBe(
    true
  );

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  if (await page.getByTestId("calendar-view-month").isVisible()) {
    await page.getByTestId("calendar-view-month").click();
  }
  await expect(page.getByTestId(`calendar-entry-${generatedEntries[0]?.id}`))
    .toHaveCount(3);
});

test("downloads a complete JSON backup without raw calendar payloads", async ({
  page
}) => {
  const childName = "Export Kind";
  await openApp(page);
  await createChild(page, childName);
  await createEntry(page, {
    childName,
    startDay: 6,
    startTime: "09:00",
    endDay: 6,
    endTime: "15:00",
    note: "Synthetic export entry"
  });
  await importExternalCalendar(page, "Synthetic Export Calendar");

  await navigate(page, "backup");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  let raw = "";
  for await (const chunk of stream!) raw += chunk.toString();
  const backup = JSON.parse(raw) as {
    application: string;
    data: {
      children: Array<{ name: string }>;
      entries: Array<{ notes?: string }>;
      settings: Record<string, unknown>;
      externalCalendarSources: Array<{ id: string; name: string }>;
      externalCalendarEvents: Array<{ sourceId: string; title: string; rawHash: string }>;
    };
  };

  expect(backup.application).toBe("betreuungskalender");
  expect(backup.data.children).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: childName })
  ]));
  expect(backup.data.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ notes: "Synthetic export entry" })
  ]));
  expect(backup.data.settings).toEqual(expect.objectContaining({ kilometerRate: expect.any(Number) }));
  expect(backup.data.externalCalendarSources).toHaveLength(1);
  expect(backup.data.externalCalendarEvents).toEqual([
    expect.objectContaining({ title: "E2E Holiday", rawHash: expect.any(String) })
  ]);
  expect(backup.data.externalCalendarEvents[0]?.sourceId).toBe(
    backup.data.externalCalendarSources[0]?.id
  );
  expect(raw).not.toContain("BEGIN:VCALENDAR");
  expect(raw).not.toContain("NODE_ENV");
  expect(raw).not.toContain("DATABASE_PATH");
  expect(raw).not.toContain("process.env");
});
