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
