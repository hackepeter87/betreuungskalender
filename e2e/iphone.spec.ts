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
