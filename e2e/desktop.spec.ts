import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  createHoliday,
  dateInCurrentMonth,
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

test("shows authenticated user and logout action when session metadata is available", async ({
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
            displayName: "parent",
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
  await expect(page.getByTestId("auth-session")).toContainText("parent");
  await expect(page.getByTestId("auth-logout")).toHaveAttribute(
    "href",
    "/oauth2/sign_out"
  );
});

test("shows native OIDC login action when authentication is required", async ({
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
          authenticated: false,
          loginUrl: "/auth/login"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await expect(page.getByTestId("auth-login")).toContainText("Nicht angemeldet");
  await expect(page.getByTestId("auth-login").getByRole("link", { name: "Anmelden" }))
    .toHaveAttribute("href", "/auth/login");
});

test("uses native OIDC POST logout and returns to unauthenticated state", async ({
  page
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let authenticated = true;
    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
      const path = new URL(url, window.location.href).pathname;
      const method = init?.method?.toUpperCase() ?? "GET";
      if (path === "/auth/logout" && method === "POST") {
        authenticated = false;
        return Promise.resolve(new Response(JSON.stringify({
          authenticated: false,
          loggedOut: true
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      if (path === "/api/session") {
        return Promise.resolve(new Response(JSON.stringify(authenticated
          ? {
              authRequired: true,
              authenticated: true,
              user: {
                id: "user_e2e_parent",
                displayName: "parent",
                role: "parent",
                email: "parent@example.test"
              },
              logoutUrl: "/auth/logout"
            }
          : {
              authRequired: true,
              authenticated: false,
              loginUrl: "/auth/login"
            }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }));
      }
      return originalFetch(input, init);
    };
  });

  await openApp(page);
  await expect(page.getByTestId("auth-session")).toContainText("parent");
  await page.getByTestId("auth-logout").click();
  await expect(page.getByTestId("auth-session")).toHaveCount(0);
  await expect(page.getByTestId("auth-login")).toContainText("Nicht angemeldet");
});

test("keeps the shell quiet in local development without authentication", async ({
  page
}) => {
  await openApp(page);
  await expect(page.getByTestId("auth-session")).toHaveCount(0);
});

test("creates a personal calendar feed URL from settings", async ({
  page,
  request
}) => {
  await openApp(page);
  await navigate(page, "settings");

  const manager = page.getByTestId("calendar-feed-manager");
  await expect(manager).toContainText("Noch kein persönlicher Feed aktiv");
  await manager.getByTestId("calendar-feed-rotate").click();
  await expect(manager).toContainText("Neue Feed-URL erzeugt");
  await expect(manager).toContainText("Feed aktiv seit");

  const feedUrl = await manager.getByTestId("calendar-feed-url").inputValue();
  expect(feedUrl).toMatch(/^http:\/\/127\.0\.0\.1:3100\/calendar\/[A-Za-z0-9_-]+\.ics$/);
  const feed = await request.get(new URL(feedUrl).pathname);
  expect(feed.ok()).toBeTruthy();
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  await expect(manager.getByTestId("calendar-feed-revoke")).toBeEnabled();
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

test("uses compact required-field markers in forms", async ({ page }) => {
  const childName = "Pflichtfeld Kind";
  await openApp(page);
  await createChild(page, childName);

  await navigate(page, "calendar");
  await page.getByTestId(`calendar-day-${dateInCurrentMonth(8)}`).click();
  const form = page.getByTestId("entry-form");
  await expect(form.locator(".requirement-badge")).toHaveCount(0);
  await expect(form.locator(".required-mark")).not.toHaveCount(0);
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
  await expect(page.getByTestId("contact-preview-new-occurrence")).toHaveCount(3);
  await expect(page.getByTestId("contact-preview-day-2026-07-03").first())
    .toHaveClass(/contact-preview-day--active/);
  await expect(page.getByTestId("contact-preview-day-2026-07-02").first())
    .not.toHaveClass(/contact-preview-day--active/);

  await page.getByTestId("contact-pattern-save").click();
  await expect(page.getByTestId("contact-message")).toContainText(
    "Umgangsregel gespeichert"
  );
  await page.getByTestId("contact-generate").click();
  await expect(page.getByTestId("contact-message")).toContainText(
    "3 geplante Umgangstermine"
  );
  await expect(page.getByTestId("contact-generated-entry")).toHaveCount(3);
  await expect(page.getByTestId("contact-preview-new-occurrence")).toHaveCount(0);
  await expect(page.getByTestId("contact-preview-existing-occurrence")).toHaveCount(3);
  await expect(page.getByTestId("contact-generation-preview")).toContainText(
    "bereits erzeugt"
  );

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

test("derives unavailability impact hints from planned contact and holidays", async ({
  page,
  request
}) => {
  const childName = "Abwesenheit Kind";
  await openApp(page);
  await createChild(page, childName);

  const childrenResponse = await request.get("/api/children");
  expect(childrenResponse.ok()).toBeTruthy();
  const [child] = await childrenResponse.json() as Array<{ id: string }>;
  expect(child?.id).toBeTruthy();

  const entryResponse = await request.post("/api/care-entries", {
    data: {
      startDateTime: "2026-07-03T16:00:00.000Z",
      endDateTime: "2026-07-05T18:00:00.000Z",
      childIds: [child.id],
      generatedByPatternId: "pattern_synthetic_e2e",
      ruleOccurrenceDate: "2026-07-03",
      status: "planned",
      overnight: true,
      schoolHandover: false,
      holiday: false,
      weekend: true,
      additionalCare: false,
      location: "main_residence",
      hasEvidence: false,
      trips: [],
      costs: []
    }
  });
  expect(entryResponse.ok()).toBeTruthy();

  const holidayResponse = await request.post("/api/holiday-periods", {
    data: {
      name: "Fiktiver Ferienblock",
      startDate: "2026-07-01",
      endDate: "2026-07-10",
      childIds: [child.id],
      assignedTo: "father"
    }
  });
  expect(holidayResponse.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("app-loading")).toBeHidden();
  await navigate(page, "unavailable");
  await expect(page.getByTestId("page-unavailable")).toBeVisible();
  await page.getByTestId("unavailable-add").click();
  const form = page.getByTestId("unavailable-form");
  await form.getByTestId("unavailable-start-date").fill("2026-07-03");
  await form.getByTestId("unavailable-start-time").fill("15:00");
  await form.getByTestId("unavailable-end-date").fill("2026-07-03");
  await form.getByTestId("unavailable-end-time").fill("20:00");

  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "geplanten Umgangstermin"
  );
  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "Ferienblock"
  );
  await expect(form).toContainText("Prüfe, ob „Betrifft Umgang“ markiert");
  await expect(form).toContainText("Prüfe, ob „Betrifft Ferien“ markiert");

  await form.getByTestId("unavailable-affects-contact").check({ force: true });
  await form.getByTestId("unavailable-affects-holidays").check({ force: true });
  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "wird im Soll-Ist-Hinweis berücksichtigt"
  );
  await expect(form.getByTestId("unavailable-derived-impact")).toContainText(
    "wird in Ferienhinweisen berücksichtigt"
  );
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
