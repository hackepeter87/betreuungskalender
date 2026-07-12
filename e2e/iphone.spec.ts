import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  expectNoDocumentHorizontalOverflow,
  expectNoUnavailableModalOverflow,
  navigate,
  openApp,
  resetApp
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("uses mobile navigation and the agenda for entry creation", async ({
  page
}) => {
  const childName = "Mia Test";
  await openApp(page);
  await expect(page.getByTestId("mobile-navigation")).toBeVisible();
  await createChild(page, childName);

  await createEntry(page, {
    childName,
    startDay: 14,
    startTime: "14:00",
    endDay: 14,
    endTime: "16:00",
    note: "Fiktiver iPhone-Eintrag",
    withTripAndCost: true
  });

  await navigate(page, "calendar");
  await expect(page.getByTestId("calendar-view-agenda"))
    .toHaveClass(/is-active/);
  await expect(page.getByText(childName).first()).toBeVisible();

  await navigate(page, "entries");
  await expect(page.getByText(childName).first()).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
});

test("keeps mobile agenda scoped to the selected month", async ({
  page,
  request
}) => {
  const childResponse = await request.post("/api/children", {
    data: {
      name: "Agenda Kind",
      birthMonth: 5,
      birthYear: 2018,
      color: "#0f8b83"
    }
  });
  expect(childResponse.ok()).toBeTruthy();
  const child = await childResponse.json() as { id: string };

  const marchHoliday = await request.post("/api/holiday-periods", {
    data: {
      name: "Osterferien 2026 Nordrhein-Westfalen",
      startDate: "2026-03-30",
      endDate: "2026-04-11",
      childIds: [child.id],
      assignedTo: "shared"
    }
  });
  expect(marchHoliday.ok()).toBeTruthy();

  const julyHoliday = await request.post("/api/holiday-periods", {
    data: {
      name: "Sommerferien 2026 Nordrhein-Westfalen",
      startDate: "2026-07-20",
      endDate: "2026-08-04",
      childIds: [child.id],
      assignedTo: "shared"
    }
  });
  expect(julyHoliday.ok()).toBeTruthy();

  await openApp(page);
  await navigate(page, "calendar");
  await expect(page.getByTestId("calendar-view-agenda")).toHaveClass(/is-active/);
  await expect(page.getByText("Juli 2026").first()).toBeVisible();
  await expect(page.getByText("Osterferien 2026 Nordrhein-Westfalen")).toHaveCount(0);
  await expect(page.getByText("Sommerferien 2026 Nordrhein-Westfalen").first()).toBeVisible();
  await expect(page.getByTestId("agenda-day-2026-08-01")).toHaveCount(0);
  await expect(page.getByTestId("agenda-day-2026-08-04")).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
});

test("keeps critical mobile pages within the viewport", async ({
  page,
  request
}) => {
  const childResponse = await request.post("/api/children", {
    data: {
      name: "Layout Kind",
      birthMonth: 4,
      birthYear: 2019,
      color: "#6b63e5"
    }
  });
  expect(childResponse.ok()).toBeTruthy();
  const child = await childResponse.json() as { id: string };

  const partyResponse = await request.post("/api/care-parties", {
    data: {
      name: "Vater",
      kind: "father"
    }
  });
  expect(partyResponse.ok()).toBeTruthy();
  const party = await partyResponse.json() as { id: string };

  await request.post("/api/holiday-periods", {
    data: {
      name: "Sommerferien 2026 Nordrhein-Westfalen",
      startDate: "2026-07-20",
      endDate: "2026-08-04",
      childIds: [child.id],
      assignedTo: "shared"
    }
  });
  await request.post("/api/care-entries", {
    data: {
      startDateTime: "2026-07-31T16:00:00.000Z",
      endDateTime: "2026-08-02T18:00:00.000Z",
      childIds: [child.id],
      status: "planned",
      overnight: true,
      schoolHandover: false,
      holiday: true,
      weekend: true,
      additionalCare: false,
      responsiblePartyId: party.id,
      location: "other",
      customLocation: "Anderer Ort",
      hasEvidence: false,
      trips: [],
      costs: []
    }
  });
  await request.post("/api/unavailable-periods", {
    data: {
      startDateTime: "2026-07-02T08:00:00.000Z",
      endDateTime: "2026-07-02T17:00:00.000Z",
      category: "duty",
      dutyRelated: true,
      affectsContact: false,
      affectsHolidays: false,
      scope: "own_unavailability",
      location: "Dienststätte",
      childIds: []
    }
  });

  await openApp(page);
  await navigate(page, "calendar");
  await page.getByTestId("calendar-add-entry").click();
  const entryForm = page.getByTestId("entry-form");
  await expect(entryForm).toBeVisible();
  const entryFormBox = await entryForm.boundingBox();
  expect(entryFormBox).toBeTruthy();
  for (const field of await entryForm.locator(".datetime-grid input").all()) {
    const fieldBox = await field.boundingBox();
    expect(fieldBox).toBeTruthy();
    expect(fieldBox!.height).toBeLessThanOrEqual(42);
    expect(fieldBox!.x).toBeGreaterThanOrEqual(entryFormBox!.x - 1);
    expect(fieldBox!.x + fieldBox!.width).toBeLessThanOrEqual(entryFormBox!.x + entryFormBox!.width + 1);
  }
  for (const helpButton of await entryForm.locator(".field-help-button").all()) {
    const helpButtonBox = await helpButton.boundingBox();
    expect(helpButtonBox).toBeTruthy();
    expect(helpButtonBox!.width).toBeLessThanOrEqual(30);
    expect(helpButtonBox!.height).toBeLessThanOrEqual(30);
    expect(helpButtonBox!.x + helpButtonBox!.width).toBeLessThanOrEqual(entryFormBox!.x + entryFormBox!.width + 1);
  }
  for (const toggle of await entryForm.locator(".toggle-row .toggle").all()) {
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox).toBeTruthy();
    expect(toggleBox!.height).toBeLessThanOrEqual(38);
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(entryFormBox!.x + entryFormBox!.width + 1);
  }
  for (const section of await entryForm.locator(".form-section--collapsible").all()) {
    const summary = section.locator(":scope > .form-section__summary");
    await summary.scrollIntoViewIfNeeded();
    const sectionBox = await section.boundingBox();
    const summaryBox = await summary.boundingBox();
    expect(sectionBox).toBeTruthy();
    expect(summaryBox).toBeTruthy();
    expect(summaryBox!.height).toBeLessThanOrEqual(46);
    expect(summaryBox!.x).toBeGreaterThanOrEqual(sectionBox!.x - 1);
    expect(summaryBox!.x + summaryBox!.width).toBeLessThanOrEqual(sectionBox!.x + sectionBox!.width + 1);
  }
  await page.getByRole("button", { name: "Abbrechen" }).first().click();
  await expect(entryForm).toBeHidden();
  await expectNoDocumentHorizontalOverflow(page);

  for (const destination of [
    "dashboard",
    "calendar",
    "entries",
    "analytics",
    "holidays",
    "backup",
    "audit",
    "unavailable",
    "settings"
  ] as const) {
    await navigate(page, destination);
    await expectNoDocumentHorizontalOverflow(page);
  }

  await navigate(page, "entries");
  const entryStatusFilters = page.locator(".list-toolbar .segmented-control").first();
  await entryStatusFilters.scrollIntoViewIfNeeded();
  await expect(entryStatusFilters).toBeVisible();
  const filterMetrics = await entryStatusFilters.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    buttonCount: element.querySelectorAll("button").length
  }));
  expect(filterMetrics.buttonCount).toBe(5);
  expect(filterMetrics.scrollWidth).toBeLessThanOrEqual(filterMetrics.clientWidth + 1);
  const entryStatusFiltersBox = await entryStatusFilters.boundingBox();
  expect(entryStatusFiltersBox).toBeTruthy();
  for (const filterButton of await entryStatusFilters.locator("button").all()) {
    const filterButtonBox = await filterButton.boundingBox();
    expect(filterButtonBox).toBeTruthy();
    expect(filterButtonBox!.x).toBeGreaterThanOrEqual(entryStatusFiltersBox!.x - 1);
    expect(filterButtonBox!.x + filterButtonBox!.width).toBeLessThanOrEqual(
      entryStatusFiltersBox!.x + entryStatusFiltersBox!.width + 1
    );
  }
  await expectNoDocumentHorizontalOverflow(page);

  await navigate(page, "analytics");
  const exportActions = page.locator(".analytics-export-actions").first();
  await exportActions.scrollIntoViewIfNeeded();
  await expect(exportActions).toBeVisible();
  const exportActionsBox = await exportActions.boundingBox();
  expect(exportActionsBox).toBeTruthy();
  for (const exportAction of await exportActions.locator(".action-with-help").all()) {
    const exportActionBox = await exportAction.boundingBox();
    expect(exportActionBox).toBeTruthy();
    expect(exportActionBox!.x).toBeGreaterThanOrEqual(exportActionsBox!.x - 1);
    expect(exportActionBox!.x + exportActionBox!.width).toBeLessThanOrEqual(exportActionsBox!.x + exportActionsBox!.width + 1);
    expect(exportActionBox!.width).toBeGreaterThan(exportActionsBox!.width * 0.9);
    for (const actionPart of await exportAction.locator(":scope > *").all()) {
      const actionPartBox = await actionPart.boundingBox();
      expect(actionPartBox).toBeTruthy();
      expect(actionPartBox!.x).toBeGreaterThanOrEqual(exportActionBox!.x - 1);
      expect(actionPartBox!.x + actionPartBox!.width).toBeLessThanOrEqual(exportActionBox!.x + exportActionBox!.width + 1);
    }
  }
  await expectNoDocumentHorizontalOverflow(page);

  await navigate(page, "settings");
  const notificationPreferences = page.getByTestId("notification-preferences");
  await notificationPreferences.scrollIntoViewIfNeeded();
  await expect(notificationPreferences).toBeVisible();
  await expect(notificationPreferences).not.toContainText("E-Mail");
  await expect(notificationPreferences).not.toContainText("Email");
  await expect(notificationPreferences).not.toContainText("SMTP");
  await expect(notificationPreferences.locator(".notification-preferences-row--head > span")).toHaveCount(3);
  for (const preferenceRow of await notificationPreferences.locator(".notification-preferences-row").all()) {
    const preferenceRowBox = await preferenceRow.boundingBox();
    expect(preferenceRowBox).toBeTruthy();
    for (const preferenceCell of await preferenceRow.locator(":scope > *").all()) {
      const preferenceCellBox = await preferenceCell.boundingBox();
      expect(preferenceCellBox).toBeTruthy();
      expect(preferenceCellBox!.x).toBeGreaterThanOrEqual(preferenceRowBox!.x - 1);
      expect(preferenceCellBox!.x + preferenceCellBox!.width).toBeLessThanOrEqual(
        preferenceRowBox!.x + preferenceRowBox!.width + 1
      );
    }
  }
  await expectNoDocumentHorizontalOverflow(page);

  const calendarFeedManager = page.getByTestId("calendar-feed-manager");
  await calendarFeedManager.scrollIntoViewIfNeeded();
  await expect(calendarFeedManager).toBeVisible();
  await calendarFeedManager.getByTestId("calendar-feed-scope").selectOption(`party:${party.id}`);
  await calendarFeedManager.getByTestId("calendar-feed-rotate").click();
  await expect(calendarFeedManager).toContainText("Feed aktiv seit");
  const calendarFeedManagerBox = await calendarFeedManager.boundingBox();
  expect(calendarFeedManagerBox).toBeTruthy();
  for (const feedElementSelector of [
    ".calendar-feed-status",
    ".calendar-feed-scope-field",
    ".settings-note"
  ]) {
    const feedElement = calendarFeedManager.locator(feedElementSelector).first();
    await feedElement.scrollIntoViewIfNeeded();
    const feedElementBox = await feedElement.boundingBox();
    expect(feedElementBox).toBeTruthy();
    expect(feedElementBox!.x).toBeGreaterThanOrEqual(calendarFeedManagerBox!.x - 1);
    expect(feedElementBox!.x + feedElementBox!.width).toBeLessThanOrEqual(calendarFeedManagerBox!.x + calendarFeedManagerBox!.width + 1);
  }
  const feedHelpButton = calendarFeedManager.locator(".calendar-feed-scope-field .field-help-button").first();
  const feedHelpButtonBox = await feedHelpButton.boundingBox();
  expect(feedHelpButtonBox).toBeTruthy();
  expect(feedHelpButtonBox!.width).toBeLessThanOrEqual(30);
  expect(feedHelpButtonBox!.height).toBeLessThanOrEqual(30);
  await expectNoDocumentHorizontalOverflow(page);

  await navigate(page, "holidays");
  const holidaySummary = page.locator(".summary-strip--five").first();
  await holidaySummary.scrollIntoViewIfNeeded();
  await expect(holidaySummary).toBeVisible();
  const holidaySummaryBox = await holidaySummary.boundingBox();
  const finalHolidayMetricBox = await holidaySummary.locator(":scope > div").nth(4).boundingBox();
  expect(holidaySummaryBox).toBeTruthy();
  expect(finalHolidayMetricBox).toBeTruthy();
  expect(finalHolidayMetricBox!.x).toBeGreaterThanOrEqual(holidaySummaryBox!.x - 1);
  expect(finalHolidayMetricBox!.x + finalHolidayMetricBox!.width).toBeLessThanOrEqual(
    holidaySummaryBox!.x + holidaySummaryBox!.width + 1
  );
  expect(finalHolidayMetricBox!.width).toBeGreaterThan(holidaySummaryBox!.width * 0.9);

  const statsGrid = page.locator(".stats-grid").first();
  await statsGrid.scrollIntoViewIfNeeded();
  await expect(statsGrid).toContainText("Vater");
  const statsGridBox = await statsGrid.boundingBox();
  expect(statsGridBox).toBeTruthy();
  for (const statCard of await statsGrid.locator(":scope > div").all()) {
    const statCardBox = await statCard.boundingBox();
    expect(statCardBox).toBeTruthy();
    expect(statCardBox!.x).toBeGreaterThanOrEqual(statsGridBox!.x - 1);
    expect(statCardBox!.x + statCardBox!.width).toBeLessThanOrEqual(statsGridBox!.x + statsGridBox!.width + 1);
  }
  await expectNoDocumentHorizontalOverflow(page);
});

test("keeps mobile contact rule time spans inside their card", async ({
  page
}) => {
  await openApp(page);
  await createChild(page, "Regel Layout Kind");

  await navigate(page, "contact");
  const segmentRow = page.locator(".rule-segment-row").first();
  await segmentRow.scrollIntoViewIfNeeded();
  await expect(segmentRow).toBeVisible();

  const rowBox = await segmentRow.boundingBox();
  expect(rowBox).toBeTruthy();
  for (const input of await segmentRow.locator("input").all()) {
    const inputBox = await input.boundingBox();
    expect(inputBox).toBeTruthy();
    expect(inputBox!.x).toBeGreaterThanOrEqual(rowBox!.x - 1);
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
  }

  const summary = page.locator(".summary-strip--seven").first();
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toBeVisible();
  const summaryBox = await summary.boundingBox();
  const finalMetricBox = await summary.locator(":scope > div").nth(6).boundingBox();
  expect(summaryBox).toBeTruthy();
  expect(finalMetricBox).toBeTruthy();
  expect(finalMetricBox!.x).toBeGreaterThanOrEqual(summaryBox!.x - 1);
  expect(finalMetricBox!.x + finalMetricBox!.width).toBeLessThanOrEqual(summaryBox!.x + summaryBox!.width + 1);
  expect(finalMetricBox!.width).toBeGreaterThan(summaryBox!.width * 0.9);

  await page.getByTestId("contact-pattern-save").click();
  await expect(page.getByTestId("contact-message")).toContainText("Umgangsregel gespeichert");
  const generatedEntry = page.getByTestId("contact-generated-entry").first();
  await generatedEntry.scrollIntoViewIfNeeded();
  await expect(generatedEntry).toBeVisible();
  const generatedEntryBox = await generatedEntry.boundingBox();
  expect(generatedEntryBox).toBeTruthy();
  for (const action of await generatedEntry.locator(".rule-entry__actions > *").all()) {
    const actionBox = await action.boundingBox();
    expect(actionBox).toBeTruthy();
    expect(actionBox!.x).toBeGreaterThanOrEqual(generatedEntryBox!.x - 1);
    expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(generatedEntryBox!.x + generatedEntryBox!.width + 1);
  }
  await expectNoDocumentHorizontalOverflow(page);
});

test("opens authenticated user menu from the mobile header", async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      if (new URL(url, window.location.href).pathname === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify({
          authRequired: true,
          authenticated: true,
          user: {
            id: "user_e2e_parent",
            displayName: "Nils Demo",
            role: "parent",
            email: "parent@example.test"
          },
          logoutUrl: "/oauth2/sign_out"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await expect(page.getByTestId("mobile-auth-session")).toBeVisible();
  await expect(page.getByTestId("mobile-auth-menu")).toHaveCount(0);
  await page.getByTestId("mobile-auth-session").click();
  await expect(page.getByTestId("mobile-auth-menu")).toBeVisible();
  await expect(page.getByTestId("mobile-auth-menu")).toContainText("Nils Demo");
  await expect(page.getByTestId("mobile-auth-menu")).toContainText("parent");
  await expect(page.getByTestId("mobile-auth-logout")).toBeVisible();
  await expect(page.getByTestId("mobile-auth-logout")).toHaveAttribute(
    "href",
    "/oauth2/sign_out"
  );
  await expectNoDocumentHorizontalOverflow(page);
});

test("explains read-only mode on mobile when the server is unavailable", async ({
  context,
  page
}) => {
  await openApp(page);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  const banner = page.getByTestId("offline-banner");
  await expect(banner).toHaveAttribute("data-state", "readonly");
  await expect(page.getByTestId("offline-existing-data")).toBeVisible();
  await expect(page.getByTestId("mobile-entry-create")).toBeDisabled();

  await navigate(page, "calendar");
  await expect(page.getByTestId("page-calendar")).toBeVisible();
  await expect(page.getByTestId("calendar-add-entry")).toBeDisabled();

  await context.setOffline(false);
});

test("keeps the unavailability modal contained on mobile", async ({ page }) => {
  await openApp(page);
  await navigate(page, "unavailable");
  await page.getByTestId("unavailable-add").click();
  await expect(page.getByTestId("unavailable-form")).toBeVisible();
  await expectNoUnavailableModalOverflow(page);
});
