import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  navigate,
  openApp,
  type AppPage
} from "./helpers";

import { fixedNow, seedVisualFixture, stabilizeRuntimeResponses, stabilizeRendering } from "./visual-fixture";

async function expectVisibleControlsUnobscured(page: Page) {
  const violations = await page.evaluate(() => {
    const tolerance = 1;
    const selectors = "button, a[href], input, select, textarea, [role='button']";
    const activeDialog = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"))
      .find((dialog) => {
        const style = window.getComputedStyle(dialog);
        const rect = dialog.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    const scope: ParentNode = activeDialog ?? document;
    const visibleFixedEdge = (selector: string, edge: "top" | "bottom") => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || window.getComputedStyle(element).display === "none") return undefined;
      return element.getBoundingClientRect()[edge];
    };
    const unobscuredTop = activeDialog ? 0 : visibleFixedEdge(".mobile-header", "bottom") ?? 0;
    const unobscuredBottom = activeDialog
      ? window.innerHeight
      : visibleFixedEdge('[data-testid="mobile-navigation"]', "top") ?? window.innerHeight;
    return Array.from(scope.querySelectorAll<HTMLElement>(selectors)).flatMap((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.visibility !== "hidden" && style.display !== "none" &&
        style.opacity !== "0" && style.pointerEvents !== "none" &&
        rect.width > 4 && rect.height > 4 &&
        rect.top >= unobscuredTop && rect.bottom <= unobscuredBottom;
      if (!visible) return [];
      const label = element.dataset.testid ?? element.getAttribute("aria-label") ??
        element.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) ?? element.tagName;
      if (rect.left < -tolerance || rect.right > window.innerWidth + tolerance) {
        return [`${label} escapes the viewport`];
      }
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const topElement = document.elementFromPoint(x, y);
      if (topElement && !element.contains(topElement) && !topElement.contains(element)) {
        const topLabel = topElement instanceof HTMLElement
          ? topElement.dataset.testid ?? topElement.getAttribute("aria-label") ??
            topElement.textContent?.trim().replace(/\s+/g, " ").slice(0, 60) ?? topElement.tagName
          : topElement.tagName;
        return [`${label} is covered by ${topElement.tagName} (${topLabel})`];
      }
      return [];
    });
  });
  expect(violations).toEqual([]);
}

async function expectViewportSnapshot(page: Page, name: string) {
  await stabilizeRendering(page);
  await expectNoDocumentHorizontalOverflow(page);
  await expectVisibleControlsUnobscured(page);
  await expect.soft(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    caret: "hide",
    fullPage: false
  });
}

const pageStates: Array<{ page: AppPage; testId: string }> = [
  { page: "dashboard", testId: "page-dashboard" },
  { page: "calendar", testId: "page-calendar" },
  { page: "settings", testId: "page-settings" },
  { page: "report", testId: "page-report" },
  { page: "backup", testId: "page-backup" }
];

test.beforeEach(async ({ page, request }) => {
  await seedVisualFixture(request);
  await page.clock.setFixedTime(new Date(fixedNow));
  await stabilizeRuntimeResponses(page);
});

test("preserves the computed shared form and feedback baseline", async ({ page }) => {
  await openApp(page);
  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll((links) =>
    links.map((link) => (link as HTMLLinkElement).href));
  expect(stylesheets.length).toBeGreaterThan(0);
  await page.setContent(`<main class="page page--narrow">
    <section class="panel-form"><div class="form-grid">
      <label class="field">Example<input></label>
      <label class="field">Example<select><option>Example</option></select></label>
      <label class="field">Example<textarea></textarea></label>
    </div><button class="button button--primary" disabled>Unavailable</button></section>
    <div class="readiness-item"><span>Example status</span></div>
    <span class="status-pill">Example status</span>
  </main>`);
  for (const url of stylesheets) await page.addStyleTag({ url });
  await stabilizeRendering(page);
  const width = page.viewportSize()!.width;
  const mobile = width < 768;
  const inputHeight = mobile ? "48px" : width < 1200 ? "44px" : "40px";
  await expect(page.locator("input")).toHaveCSS("min-height", inputHeight);
  await expect(page.locator("select")).toHaveCSS("min-height", inputHeight);
  await expect(page.locator("textarea")).toHaveCSS("min-height", mobile ? "96px" : "auto");
  await expect(page.locator(".field").first()).toHaveCSS("min-width", "0px");
  await expect(page.locator(".panel-form")).toHaveCSS("display", "grid");
  await expect(page.locator(".panel-form")).toHaveCSS("gap", "16px");
  await expect(page.locator(".readiness-item")).toHaveCSS("padding", "16px");
  await expect(page.locator(".status-pill")).toHaveCSS("min-height", mobile ? "24px" : "28px");
  await expect(page.locator("button")).toHaveCSS("pointer-events", "none");
  await expect(page.locator("button")).toHaveCSS("opacity", "0.45");
  const columns = await page.locator(".form-grid").evaluate((grid) =>
    getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(mobile ? 1 : 3);
  await expectNoDocumentHorizontalOverflow(page);
});

test("uses shared section spacing and table sizing on supporting routes", async ({ page }) => {
  await openApp(page);
  await navigate(page, "analytics");
  await expect(page.locator(".analytics-section")).toBeVisible();
  const spacing = await page.locator(".analytics-section").evaluate((element) => {
    const style = getComputedStyle(element);
    return { actual: style.marginBottom, expected: style.getPropertyValue("--section-gap").trim() };
  });
  expect(spacing.actual).toBe(spacing.expected);
  await navigate(page, "audit");
  await expect(page.locator(".audit-table")).toBeAttached();
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await expect(page.locator(".audit-table")).toHaveCSS("min-width", "830px");
  }
});

test("keeps the onboarding notice aligned with its shared notice variant", async ({ page }) => {
  await page.goto("/?onboarding=invitation");
  await expect(page.getByTestId("app-loading")).toBeHidden();
  const notice = page.getByTestId("onboarding-completion-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCSS("align-items", "center");
  await expect(notice.getByRole("button", { name: "Schließen" })).toHaveCSS("align-self", "start");
  await expectNoDocumentHorizontalOverflow(page);
});

test("keeps public legal information readable without the application shell", async ({ page }) => {
  for (const route of ["/impressum", "/datenschutz"]) {
    const response = await page.goto(route);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.locator("[data-legal-page]")).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    const content = page.locator(".legal-content");
    await content.evaluate((element) => { element.textContent += "\n" + "FictionalLongReference".repeat(20); });
    await expectNoDocumentHorizontalOverflow(page);
    await page.getByRole("link", { name: "Betreuungskalender" }).focus();
    await expect(page.getByRole("link", { name: "Betreuungskalender" })).toBeFocused();
  }
});

test("keeps shared pages and navigation visually stable", async ({ page }) => {
  await openApp(page);

  for (const state of pageStates) {
    await navigate(page, state.page);
    await expect(page.getByTestId(state.testId)).toBeVisible();
    if (state.page === "settings") {
      await expect(page.getByTestId("instance-readiness")).toBeVisible();
    }
    if (state.page === "report") {
      await page.getByTestId("page-report").getByRole("button", { name: "Jahr", exact: true }).click();
      await expect(page.getByTestId("page-report").locator('input[type="number"]')).toHaveValue("2026");
      await expect(page.getByText("BK-20260902-VISUAL01")).toBeVisible();
    }
    await expectViewportSnapshot(page, state.page);
  }

  await navigate(page, "dashboard");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  if (viewport!.width < 768) {
    const more = page.getByTestId("mobile-nav-more");
    await more.focus();
    await more.click();
    const sheet = page.getByTestId("mobile-more-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Menü schließen" })).toBeFocused();
    await expectViewportSnapshot(page, "navigation-more-open");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
    return;
  }

  await expectViewportSnapshot(page, "navigation-open");
  const collapse = page.getByTestId("sidebar-collapse-control");
  await collapse.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("app-shell")).toHaveClass(/app-shell--sidebar-collapsed/);
  await expectViewportSnapshot(page, "navigation-collapsed");

  const notificationTrigger = page.getByTestId("sidebar-notification-center-trigger");
  await notificationTrigger.focus();
  await notificationTrigger.click();
  const popover = page.getByTestId("sidebar-notification-center-popover");
  await expect(popover).toBeVisible();
  const popoverBox = await popover.boundingBox();
  expect(popoverBox).not.toBeNull();
  expect(popoverBox!.x).toBeGreaterThanOrEqual(0);
  expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(viewport!.height);
  await expectViewportSnapshot(page, "navigation-collapsed-popover");
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(notificationTrigger).toBeFocused();
});
