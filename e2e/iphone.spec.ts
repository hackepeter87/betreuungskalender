import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
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
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
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
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
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
