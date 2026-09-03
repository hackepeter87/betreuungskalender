import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  dateInCurrentMonth,
  navigate,
  openApp,
  resetApp,
  type AppPage
} from "./helpers";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoBlockingAccessibilityViolations(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious"
  );
  const details = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      html: node.html,
      reason: node.failureSummary
    }))
  }));
  expect(details, `${state} has blocking accessibility violations`).toEqual([]);
}

async function createFictionalChild(page: Page) {
  const response = await page.request.post("/api/children", {
    data: {
      name: "Fiktives Kind",
      birthMonth: 4,
      birthYear: 2018,
      color: "#0f8b83"
    }
  });
  expect(response.ok(), await response.text()).toBe(true);
}

async function createCalendarOverflowFixture(page: Page) {
  const childrenResponse = await page.request.get("/api/children");
  expect(childrenResponse.ok(), await childrenResponse.text()).toBe(true);
  const children = await childrenResponse.json() as Array<{ id: string }>;
  expect(children[0]?.id).toBeTruthy();
  const date = dateInCurrentMonth(12);

  for (let index = 1; index <= 4; index += 1) {
    const response = await page.request.post("/api/holiday-periods", {
      data: {
        name: `Fiktiver Ferienzeitraum ${index}`,
        startDate: date,
        endDate: date,
        childIds: [children[0].id],
        assignedTo: "shared"
      }
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await resetApp(page.request);
  await createFictionalChild(page);
});

test("has no serious or critical WCAG violations on representative routes", async ({ page }) => {
  await openApp(page);

  const routes: Array<{ page: AppPage; testId: string }> = [
    { page: "dashboard", testId: "page-dashboard" },
    { page: "calendar", testId: "page-calendar" },
    { page: "settings", testId: "page-settings" },
    { page: "backup", testId: "page-backup" },
    { page: "report", testId: "page-report" }
  ];

  for (const route of routes) {
    if (route.page !== "dashboard") await navigate(page, route.page);
    await expect(page.getByTestId(route.testId)).toBeVisible();
    await expectNoBlockingAccessibilityViolations(page, route.page);
  }

  await page.goto("/datenschutz");
  await expect(page.locator("[data-legal-page]")).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page, "privacy page");
});

test("keeps dialogs and responsive navigation accessible", async ({ page }) => {
  await createCalendarOverflowFixture(page);
  await openApp(page);
  const desktopEntryTrigger = page.getByTestId("dashboard-new-entry");
  const mobileEntryTrigger = page.getByTestId("mobile-entry-create");
  const entryTrigger = await mobileEntryTrigger.isVisible() ? mobileEntryTrigger : desktopEntryTrigger;
  await entryTrigger.click();
  const entryDialog = page.getByRole("dialog");
  await expect(entryDialog).toBeVisible();
  await expect(entryDialog.locator(":focus")).toHaveCount(1);
  const closeButton = entryDialog.locator(".modal__header .icon-button");
  await closeButton.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(entryDialog.locator(":focus")).toHaveCount(1);
  await expectNoBlockingAccessibilityViolations(page, "entry dialog");

  const helpTrigger = entryDialog.locator(".field-help-button").first();
  await helpTrigger.click();
  const helpDialog = page.locator(".field-help-dialog");
  await expect(helpDialog).toBeVisible();
  await expect(helpDialog.locator(":focus")).toHaveCount(1);
  await expectNoBlockingAccessibilityViolations(page, "field help dialog");
  await page.keyboard.press("Escape");
  await expect(helpDialog).toBeHidden();
  await expect(entryDialog).toBeVisible();
  await expect(helpTrigger).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(entryDialog).toBeHidden();
  await expect(entryTrigger).toBeFocused();

  const mobileNavigation = page.getByTestId("mobile-navigation");
  if (await mobileNavigation.isVisible()) {
    const trigger = page.getByTestId("mobile-nav-more");
    await trigger.click({ force: true });
    const sheet = page.getByTestId("mobile-more-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(":focus")).toHaveCount(1);
    const closeButton = sheet.locator(".mobile-more-sheet__header .icon-button");
    await closeButton.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(sheet.locator(":focus")).toHaveCount(1);
    await expectNoBlockingAccessibilityViolations(page, "mobile more navigation");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    return;
  }

  await navigate(page, "calendar");
  const dayOverflowTrigger = page.locator(".calendar-day__more").first();
  await expect(dayOverflowTrigger).toBeVisible();
  await dayOverflowTrigger.click();
  const dayDialog = page.locator(".calendar-day-popover");
  await expect(dayDialog).toBeVisible();
  await expect(dayDialog.locator(":focus")).toHaveCount(1);
  const closeDayButton = dayDialog.locator(".calendar-day-popover__header .icon-button");
  await closeDayButton.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dayDialog.locator(":focus")).toHaveCount(1);
  await expectNoBlockingAccessibilityViolations(page, "calendar day overview");
  await page.keyboard.press("Escape");
  await expect(dayDialog).toBeHidden();
  await expect(dayOverflowTrigger).toBeFocused();

  const trigger = page.getByTestId("sidebar-notification-center-trigger");
  await trigger.click();
  const popover = page.getByTestId("sidebar-notification-center-popover");
  await expect(popover).toBeVisible();
  await expectNoBlockingAccessibilityViolations(page, "notification popover");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("reflows the core workflow at 320 CSS pixels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Covered once with the desktop browser engine.");
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoBlockingAccessibilityViolations(page, "320px dashboard");

  await navigate(page, "settings");
  await expect(page.getByTestId("page-settings")).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoBlockingAccessibilityViolations(page, "320px settings");
});
