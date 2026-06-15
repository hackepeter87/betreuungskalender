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

async function expectNoPageOverflow(page: import("@playwright/test").Page) {
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
}

test("keeps the side navigation and month calendar usable", async ({ page }) => {
  const childName = "Noah Muster";
  await openApp(page);
  await expect(page.getByRole("navigation", {
    name: "Hauptnavigation"
  })).toBeVisible();

  await navigate(page, "Einstellungen");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expectNoPageOverflow(page);
  await navigate(page, "Übersicht");

  await createChild(page, childName);

  await navigate(page, "Übersicht");
  await page.getByRole("button", {
    name: "Eintrag erfassen",
    exact: true
  }).click();
  const dashboardDialog = page.getByRole("dialog", {
    name: "Betreuungseintrag erfassen"
  });
  await expect(dashboardDialog).toBeVisible();
  await expectNoPageOverflow(page);
  await dashboardDialog.getByRole("button", { name: "Schließen" }).click();

  await createEntry(page, {
    childName,
    startDay: 16,
    startTime: "17:30",
    endDay: 17,
    endTime: "08:00",
    note: "Fiktiver iPad-Eintrag",
    overnight: true
  });

  await navigate(page, "Kalender");
  await expect(page.locator(".calendar-panel--large")).toBeVisible();
  await expect(page.getByText(childName).first()).toBeVisible();
  await expectNoPageOverflow(page);
});

test("avoids page overflow at compact and landscape tablet sizes", async ({
  page
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openApp(page);
  await expectNoPageOverflow(page);
  await navigate(page, "Kalender");
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 1194, height: 834 });
  await navigate(page, "Übersicht");
  await expectNoPageOverflow(page);
  await navigate(page, "Einstellungen");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expectNoPageOverflow(page);
});
