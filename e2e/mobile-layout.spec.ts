import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  createChild,
  expectNoDocumentHorizontalOverflow,
  navigate,
  openApp,
  resetApp
} from "./helpers";

async function expectChildrenInside(owner: Locator, children: Locator) {
  const boundary = await owner.boundingBox();
  expect(boundary).toBeTruthy();
  for (const child of await children.all()) {
    const box = await child.boundingBox();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(boundary!.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(boundary!.x + boundary!.width + 1);
  }
}

async function mockEmailPreferences(page: Page) {
  await page.route("**/api/notification-preferences", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preferences: [
          {
            eventType: "care_confirmation_due",
            inAppEnabled: true,
            pushEnabled: true,
            emailEnabled: true
          },
          {
            eventType: "care_confirmation_reminder",
            inAppEnabled: true,
            pushEnabled: true,
            emailEnabled: false
          }
        ],
        pushAvailable: true,
        pushConfigured: true,
        emailAvailable: true,
        emailRecipientAvailable: true,
        activePushSubscriptions: 1
      })
    });
  });
}

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

for (const viewport of [
  { width: 320, height: 800 },
  { width: 390, height: 844 }
]) {
  test(`keeps dense mobile surfaces readable inside their owners at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockEmailPreferences(page);
    await openApp(page);
    await createChild(page, "Layout Testkind");

    await navigate(page, "dashboard");
    const dashboardActions = page.locator(".page-header__actions");
    const closeMonth = page.getByTestId("dashboard-close-month").locator("..");
    const actionWidth = await dashboardActions.evaluate((element) => element.getBoundingClientRect().width);
    const closeWidth = await closeMonth.evaluate((element) => element.getBoundingClientRect().width);
    expect(closeWidth).toBeGreaterThan(actionWidth * 0.8);
    await expectChildrenInside(dashboardActions, dashboardActions.locator(":scope > *"));

    await navigate(page, "settings");
    const notificationHeader = page
      .getByTestId("notification-preferences")
      .locator(".notification-preferences-row--head");
    await expect(notificationHeader.locator(":scope > *")).toHaveCount(4);
    await expectChildrenInside(notificationHeader, notificationHeader.locator(":scope > *"));
    const cells = await notificationHeader.locator(":scope > *").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      })
    );
    for (let index = 1; index < cells.length; index += 1) {
      expect(cells[index].left).toBeGreaterThanOrEqual(cells[index - 1].right - 1);
    }
    const feedStatus = page.locator(".calendar-feed-status");
    await expectChildrenInside(feedStatus, feedStatus.locator(":scope > *"));
    await expect(feedStatus.locator(".status-pill")).toHaveText(/Nicht angelegt|Not created/);

    await navigate(page, "analytics");
    const periodSelector = page.locator(".period-selector");
    await expectChildrenInside(periodSelector, periodSelector.locator(".period-selector__anchor input"));

    await navigate(page, "holidays");
    const holidaySummary = page.locator(".summary-strip--five");
    const finalHolidayMetric = holidaySummary.locator(":scope > div").last();
    await expect(finalHolidayMetric).toHaveCSS("display", "flex");
    const finalHolidayChildren = await finalHolidayMetric.locator(":scope > *").evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top)
    );
    expect(Math.abs(finalHolidayChildren[0] - finalHolidayChildren[1])).toBeLessThanOrEqual(4);

    await navigate(page, "contact");
    const steps = page.locator(".mobile-rule-steps");
    expect(await steps.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
    const previousStep = page.locator(".mobile-rule-step-actions .button").first();
    await expect(previousStep).toBeHidden();
    await expect(page.getByTestId("contact-mobile-next-step")).toBeVisible();
    await expectChildrenInside(
      page.locator(".generator-panel .form-grid--two"),
      page.locator("[data-testid='contact-generation-start'], [data-testid='contact-generation-end']")
    );

    await navigate(page, "audit");
    const auditCell = page.locator(".audit-table tbody td").first();
    await expect(auditCell).toBeVisible();
    expect(await auditCell.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);

    await navigate(page, "report");
    const reportMetadata = page.locator(".report-document__header dl > div").first();
    await expect(reportMetadata).toBeVisible();
    expect(await reportMetadata.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);

    const pagePaddingBottom = await page.locator("main.main > .page").evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingBottom)
    );
    expect(pagePaddingBottom).toBeLessThanOrEqual(32);
    await expectNoDocumentHorizontalOverflow(page);
  });
}
