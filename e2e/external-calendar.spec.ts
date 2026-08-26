import { expect, test } from "@playwright/test";
import {
  externalCalendarReplacementFixture,
  expectNoDocumentHorizontalOverflow,
  importExternalCalendar,
  invalidCalendarFixture,
  navigate,
  openApp,
  resetApp
} from "./helpers";

const sourceName = "Synthetic E2E Calendar";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("imports, manages, and removes an external calendar through the UI", async ({
  page,
  request
}) => {
  await openApp(page);
  await importExternalCalendar(page, sourceName);

  const sourcesResponse = await request.get("/api/external-calendars");
  expect(sourcesResponse.ok()).toBeTruthy();
  const [source] = await sourcesResponse.json() as Array<{ id: string; visible: boolean }>;
  expect(source?.visible).toBe(true);

  const eventsResponse = await request.get(
    "/api/external-calendar-events?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z"
  );
  expect(eventsResponse.ok()).toBeTruthy();
  const [event] = await eventsResponse.json() as Array<{ id: string; title: string }>;
  expect(event?.title).toBe("E2E Holiday");

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  const monthViewButton = page.getByTestId("calendar-view-month");
  if (await monthViewButton.isVisible()) await monthViewButton.click();
  const gridEvents = page.getByTestId("calendar-month-view")
    .getByTestId(`external-calendar-event-${event?.id}`);
  await expect(gridEvents).toHaveCount(2);
  await gridEvents.first().click({ force: true });
  await expect(page.getByTestId("entry-form")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const agendaViewButton = page.getByTestId("calendar-view-agenda");
  await expect(agendaViewButton).toBeVisible();
  await agendaViewButton.click();
  const agendaEvent = page.locator(".agenda-list").getByTestId(`external-calendar-event-${event?.id}`);
  await expect(agendaEvent).toHaveCount(1);
  await expect(agendaEvent.getByText("E2E Holiday", { exact: true })).toBeVisible();
  const agendaEventContentBox = await agendaEvent.locator(".agenda-card__main").boundingBox();
  expect(agendaEventContentBox?.width ?? 0).toBeGreaterThan(250);
  await expectNoDocumentHorizontalOverflow(page);

  await navigate(page, "settings");
  const sourceRow = page.getByTestId(`external-calendar-source-${source?.id}`);
  await expect(sourceRow).toBeVisible();
  await page.getByTestId(`external-calendar-visible-control-${source?.id}`).click();
  await expect(page.getByTestId(`external-calendar-visible-${source?.id}`)).not.toBeChecked();
  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  await expect(page.getByTestId(`external-calendar-event-${event?.id}`)).toHaveCount(0);

  await navigate(page, "settings");
  await page.getByTestId(`external-calendar-visible-control-${source?.id}`).click();
  await expect(page.getByTestId(`external-calendar-visible-${source?.id}`)).toBeChecked();
  await page.getByTestId(`external-calendar-replace-${source?.id}`).click();
  await page.getByTestId("external-calendar-file").setInputFiles(
    externalCalendarReplacementFixture
  );
  await expect(page.getByTestId("external-calendar-message")).toContainText("1");

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  if (await page.getByTestId("calendar-view-month").isVisible()) {
    await page.getByTestId("calendar-view-month").click();
  }
  const grid = page.getByTestId("calendar-month-view");
  await expect(grid.getByText("E2E Holiday", { exact: true })).toHaveCount(0);
  await expect(grid.getByText("E2E Replacement Holiday", { exact: true })).toHaveCount(2);

  await navigate(page, "settings");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId(`external-calendar-delete-${source?.id}`).click();
  await expect(page.getByTestId(`external-calendar-source-${source?.id}`)).toHaveCount(0);

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill("2026-07");
  await expect(page.getByText("E2E Replacement Holiday", { exact: true })).toHaveCount(0);

  await navigate(page, "settings");
  const manager = page.getByTestId("external-calendar-manager");
  await manager.getByTestId("external-calendar-name").fill("Invalid synthetic calendar");
  await manager.getByTestId("external-calendar-file").setInputFiles(invalidCalendarFixture);
  await manager.getByTestId("external-calendar-import").click();
  await expect(manager.getByTestId("external-calendar-message")).toBeVisible();
  const invalidSources = await request.get("/api/external-calendars");
  expect(await invalidSources.json()).toEqual([]);
});

test("derives holiday blocks from a classified external holiday calendar", async ({
  page,
  request
}) => {
  const childName = "Ferienimport Kind";
  await openApp(page);
  await navigate(page, "settings");
  await page.getByTestId("settings-add-child").click();
  const childForm = page.getByTestId("child-form");
  await childForm.getByTestId("child-name").fill(childName);
  await childForm.getByTestId("child-submit").click();
  await expect(childForm).toBeHidden();

  await importExternalCalendar(page, sourceName);
  const sourcesResponse = await request.get("/api/external-calendars");
  expect(sourcesResponse.ok()).toBeTruthy();
  const [source] = await sourcesResponse.json() as Array<{ id: string; sourceType: string }>;
  expect(source?.sourceType).toBe("overlay");

  await page.getByTestId(`external-calendar-source-type-${source!.id}`).selectOption("holiday");
  await expect(page.getByTestId(`external-calendar-source-type-${source!.id}`)).toHaveValue("holiday");

  await navigate(page, "holidays");
  await page.getByTestId("holiday-external-source").selectOption(source!.id);
  await expect(page.getByTestId("holiday-external-assigned-to")).toHaveCount(0);
  await page.getByTestId("holiday-derive-external").click();
  await expect(page.getByTestId("holiday-external-message")).toContainText("1");
  await expect(page.getByText("E2E Holiday", { exact: true })).toBeVisible();
  await expect(page.locator(".holiday-list").getByText(childName, { exact: true })).toBeVisible();

  const firstHolidaysResponse = await request.get("/api/holiday-periods");
  expect(firstHolidaysResponse.ok()).toBeTruthy();
  const firstHolidays = await firstHolidaysResponse.json() as Array<{
    name: string;
    startDate: string;
    endDate: string;
    sourceExternalCalendarSourceId?: string;
  }>;
  expect(firstHolidays).toHaveLength(1);
  expect(firstHolidays[0]).toMatchObject({
    name: "E2E Holiday",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    sourceExternalCalendarSourceId: source!.id
  });

  await page.getByTestId("holiday-derive-external").click();
  await expect(page.getByTestId("holiday-external-message")).toContainText("0");
  const secondHolidaysResponse = await request.get("/api/holiday-periods");
  expect(secondHolidaysResponse.ok()).toBeTruthy();
  expect(await secondHolidaysResponse.json()).toHaveLength(1);
});
