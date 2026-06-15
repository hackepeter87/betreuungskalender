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
  await expect(page.getByRole("navigation", {
    name: "Mobile Navigation"
  })).toBeVisible();
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

  await navigate(page, "Kalender");
  await expect(page.getByRole("button", { name: "Agenda", exact: true }))
    .toHaveClass(/is-active/);
  await expect(page.getByText(childName).first()).toBeVisible();

  await navigate(page, "Einträge");
  await expect(page.getByText(childName).first()).toBeVisible();
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

  const banner = page.getByRole("alert");
  await expect(banner).toContainText("Nur-Lese-Modus");
  await expect(banner).toContainText(
    "Vorhandene Daten können angesehen und exportiert werden."
  );
  await expect(page.getByRole("button", {
    name: "Eintrag erfassen",
    exact: true
  })).toBeDisabled();

  await navigate(page, "Kalender");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Betreuungseintrag hinzufügen"
  })).toBeDisabled();

  await context.setOffline(false);
});
