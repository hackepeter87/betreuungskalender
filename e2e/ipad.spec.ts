import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  expectNoUnavailableModalOverflow,
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
  await expect(page.getByTestId("nav-calendar")).toBeVisible();

  await navigate(page, "settings");
  await expect(page.getByTestId("page-settings")).toBeVisible();
  await expectNoPageOverflow(page);
  await navigate(page, "dashboard");
  await createChild(page, childName);

  await navigate(page, "dashboard");
  await page.getByTestId("page-dashboard")
    .locator(".page-header__actions .desktop-only")
    .click();
  const dashboardForm = page.getByTestId("entry-form");
  const dashboardDialog = page.getByRole("dialog").filter({
    has: dashboardForm
  });
  await expect(dashboardDialog).toBeVisible();
  await expectNoPageOverflow(page);
  await dashboardDialog.locator(".modal__header .icon-button").click();

  await createEntry(page, {
    childName,
    startDay: 16,
    startTime: "17:30",
    endDay: 17,
    endTime: "08:00",
    note: "Fiktiver iPad-Eintrag",
    overnight: true
  });

  await navigate(page, "calendar");
  await expect(page.getByTestId("calendar-month-view")).toBeVisible();
  await expect(page.getByText(childName).first()).toBeVisible();
  await expectNoPageOverflow(page);
});

test("avoids page overflow at compact and landscape tablet sizes", async ({
  page
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openApp(page);
  await expectNoPageOverflow(page);
  await navigate(page, "calendar");
  await expectNoPageOverflow(page);

  await page.setViewportSize({ width: 1194, height: 834 });
  await navigate(page, "dashboard");
  await expectNoPageOverflow(page);
  await navigate(page, "settings");
  await expect(page.getByTestId("page-settings")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("captures the shared tablet layout", async ({ page }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-08-24T10:00:00Z"));
  await page.setViewportSize({ width: 1194, height: 834 });
  await openApp(page);
  await navigate(page, "settings");
  await expectNoPageOverflow(page);
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false
  });
  await testInfo.attach("settings-fluid-ipad.png", { body: screenshot, contentType: "image/png" });
});

test("keeps the unavailability modal contained on tablet viewports", async ({
  page
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openApp(page);
  await navigate(page, "unavailable");
  await page.getByTestId("unavailable-add").click();
  await expect(page.getByTestId("unavailable-form")).toBeVisible();
  await expectNoUnavailableModalOverflow(page);

  await page.setViewportSize({ width: 1194, height: 834 });
  await expectNoUnavailableModalOverflow(page);
});
