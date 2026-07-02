import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { resolve } from "node:path";

export type AppPage =
  | "dashboard"
  | "calendar"
  | "entries"
  | "contact"
  | "holidays"
  | "unavailable"
  | "analytics"
  | "report"
  | "backup"
  | "audit"
  | "rules"
  | "settings";

export function dateInCurrentMonth(day: number): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0")
  ].join("-");
}

export async function resetApp(request: APIRequestContext) {
  const response = await request.delete("/api/app-data");
  expect(response.ok()).toBeTruthy();
}

export async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("app-loading")).toBeHidden();
}

export async function expectNoUnavailableModalOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const tolerance = 1;
    const modal = document.querySelector(".modal--unavailable") as HTMLElement | null;
    const backdrop = modal?.closest(".modal-backdrop") as HTMLElement | null;
    const body = modal?.querySelector(".modal__body") as HTMLElement | null;
    if (!modal || !body || !backdrop) {
      return {
        docOverflow: false,
        modalOverflow: false,
        bodyOverflow: false,
        mobileNavAboveModal: false,
        visibleInputs: false,
        violations: ["missing unavailable modal"]
      };
    }

    const boundary = body.getBoundingClientRect();
    const violations: string[] = [];
    const checkInsideBody = (element: Element, label: string) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      if (rect.left < boundary.left - tolerance || rect.right > boundary.right + tolerance) {
        violations.push(`${label} escapes modal body`);
      }
    };

    modal
      .querySelectorAll(
        ".unavailable-time-group, .unavailable-toggle-card, input, select, textarea, .field-help-button"
      )
      .forEach((element) => checkInsideBody(element, element.className || element.tagName));

    modal
      .querySelectorAll(".unavailable-time-group .field-help-button, .unavailable-toggle-card .field-help-button")
      .forEach((button) => {
        const container = button.closest(".unavailable-time-group, .unavailable-toggle-card");
        if (!container) return;
        const buttonRect = button.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (
          buttonRect.left < containerRect.left - tolerance ||
          buttonRect.right > containerRect.right + tolerance
        ) {
          violations.push("help button escapes its card");
        }
      });

    const visibleInputs = [
      "unavailable-start-date",
      "unavailable-start-time",
      "unavailable-end-date",
      "unavailable-end-time"
    ].every((testId) => {
      const element = modal.querySelector(`[data-testid="${testId}"]`);
      const rect = element?.getBoundingClientRect();
      return Boolean(rect && rect.width > 40 && rect.height > 20);
    });
    const mobileNavigation = document.querySelector(
      '[data-testid="mobile-navigation"]'
    ) as HTMLElement | null;
    const toZIndex = (element: HTMLElement) => {
      const value = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
      return Number.isFinite(value) ? value : 0;
    };
    const mobileNavAboveModal =
      Boolean(mobileNavigation) &&
      window.getComputedStyle(mobileNavigation!).display !== "none" &&
      toZIndex(mobileNavigation!) >= toZIndex(backdrop);

    return {
      docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + tolerance,
      modalOverflow: modal.scrollWidth > modal.clientWidth + tolerance,
      bodyOverflow: body.scrollWidth > body.clientWidth + tolerance,
      mobileNavAboveModal,
      visibleInputs,
      violations
    };
  });

  expect(result.docOverflow).toBe(false);
  expect(result.modalOverflow).toBe(false);
  expect(result.bodyOverflow).toBe(false);
  expect(result.mobileNavAboveModal).toBe(false);
  expect(result.visibleInputs).toBe(true);
  expect(result.violations).toEqual([]);
}

export async function navigate(page: Page, destination: AppPage) {
  const mobileNavigation = page.getByTestId("mobile-navigation");
  if (await mobileNavigation.isVisible()) {
    const directButton = page.getByTestId(`mobile-nav-${destination}`);
    if (await directButton.count()) {
      // Fixed bottom navigation is visually on top; Playwright may still scroll
      // the page content under it during actionability checks on mobile.
      await directButton.click({ force: true });
      return;
    }
    await page.getByTestId("mobile-nav-more").click();
    await page.getByTestId(
      destination === "settings"
        ? "mobile-more-settings"
        : `mobile-more-${destination}`
    ).click();
    return;
  }

  await page.getByTestId(
    destination === "settings" ? "nav-settings" : `nav-${destination}`
  ).click();
}

export async function createChild(page: Page, name: string) {
  await page.getByTestId("dashboard-setup-child").click();
  await expect(page.getByTestId("page-settings")).toBeVisible();
  await page.getByTestId("settings-add-child").click();

  const form = page.getByTestId("child-form");
  await form.getByTestId("child-name").fill(name);
  await form.getByTestId("child-submit").click();

  await expect(form).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

type EntryOptions = {
  childName: string;
  startDay: number;
  startTime: string;
  endDay: number;
  endTime: string;
  note: string;
  overnight?: boolean;
  withTripAndCost?: boolean;
};

export async function createEntry(page: Page, options: EntryOptions) {
  await navigate(page, "calendar");
  const mobileAddButton = page.getByTestId("calendar-add-entry");
  if (await mobileAddButton.isVisible()) {
    await mobileAddButton.click();
  } else {
    await page.getByTestId(
      `calendar-day-${dateInCurrentMonth(options.startDay)}`
    ).click();
  }
  const form = page.getByTestId("entry-form");

  await form.getByRole("checkbox", { name: options.childName }).check();
  await form.getByTestId("entry-start-date")
    .fill(dateInCurrentMonth(options.startDay));
  await form.getByTestId("entry-start-time").fill(options.startTime);
  await form.getByTestId("entry-end-date")
    .fill(dateInCurrentMonth(options.endDay));
  await form.getByTestId("entry-end-time").fill(options.endTime);

  if (options.overnight) {
    await form.getByTestId("entry-overnight").check({ force: true });
  }

  if (options.withTripAndCost) {
    await form.getByTestId("entry-trips-toggle").click();
    await form.getByTestId("entry-trip-add").click();
    await form.getByTestId("entry-trip-km").fill("18.5");

    await form.getByTestId("entry-costs-toggle").click();
    await form.getByTestId("entry-cost-add").click();
    await form.getByTestId("entry-cost-amount").fill("12.40");
  }

  await form.getByTestId("entry-notes-toggle").click();
  await form.getByTestId("entry-notes").fill(options.note);
  const saveButton = form.getByTestId("entry-submit");
  await saveButton.click();
  await expect(form).toBeHidden();
}

export async function createHoliday(page: Page, childName: string) {
  await navigate(page, "holidays");
  await expect(page.getByTestId("page-holidays")).toBeVisible();
  await page.getByTestId("holiday-add").click();

  const form = page.getByTestId("holiday-form");
  await form.getByTestId("holiday-name").fill("Fiktiver Ferienblock");
  await form.getByTestId("holiday-start-date").fill(dateInCurrentMonth(20));
  await form.getByTestId("holiday-end-date").fill(dateInCurrentMonth(22));
  await expect(form.getByRole("checkbox", { name: childName })).toBeChecked();
  await form.getByTestId("holiday-submit").click();

  await expect(form).toBeHidden();
  await expect(page.getByText("Fiktiver Ferienblock", { exact: true })).toBeVisible();
}

export const externalCalendarFixture = resolve(
  "e2e/fixtures/external-calendar.ics"
);
export const externalCalendarReplacementFixture = resolve(
  "e2e/fixtures/external-calendar-replacement.ics"
);
export const invalidCalendarFixture = resolve("e2e/fixtures/invalid-calendar.txt");

export async function importExternalCalendar(page: Page, name: string) {
  await navigate(page, "settings");
  const manager = page.getByTestId("external-calendar-manager");
  await manager.getByTestId("external-calendar-name").fill(name);
  await manager.getByTestId("external-calendar-color").fill("#2563eb");
  await manager.getByTestId("external-calendar-file").setInputFiles(externalCalendarFixture);
  await manager.getByTestId("external-calendar-import").click();
  await expect(manager.getByTestId("external-calendar-message")).toContainText("1");
  await expect(manager.getByText(name, { exact: true })).toBeVisible();
}
