import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  createChild,
  expectNoDocumentHorizontalOverflow,
  navigate,
  openApp,
  resetApp
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("keeps the event-first care series editor responsive and accessible", async ({ page }) => {
  await openApp(page);
  await createChild(page, "Serien Kind");
  await navigate(page, "contact");

  const mobile = await page.evaluate(() => window.matchMedia("(max-width: 767px)").matches);
  const childChoice = page.locator(".child-choice-grid input").first();
  await childChoice.uncheck();
  await expect(page.getByText("Bitte mindestens ein Kind auswählen.")).toBeVisible();
  await childChoice.check();
  if (mobile) {
    await expect(page.getByTestId("contact-mobile-step-1")).toHaveAttribute("aria-current", "step");
    await page.getByTestId("contact-mobile-next-step").click();
  }

  await page.getByTestId("contact-pattern-start-date").fill("2026-10-02");
  await page.getByTestId("contact-pattern-friday-start-time").fill("16:00");
  await page.getByTestId("contact-first-end-date").fill("2026-10-02");
  await page.getByTestId("contact-pattern-sunday-end-time").fill("15:00");
  await expect(page.getByText("Das Ende des ersten Termins muss nach seinem Beginn liegen.")).toBeVisible();
  await page.getByTestId("contact-first-end-date").fill("2026-10-04");
  await page.getByTestId("contact-pattern-sunday-end-time").fill("18:00");

  if (mobile) await page.getByTestId("contact-mobile-next-step").click();
  await page.getByTestId("contact-repeat-preset").selectOption("biweekly");
  await page.getByRole("button", { name: "An einem Datum" }).click();
  await expect(page.getByTestId("contact-pattern-end-date")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Das Serienende darf nicht vor dem ersten Termin liegen.")).toBeVisible();
  await page.getByRole("button", { name: "Ohne Enddatum" }).click();

  if (mobile) await page.getByTestId("contact-mobile-next-step").click();
  await expect(page.getByTestId("contact-recurrence-summary")).toContainText("Alle zwei Wochen");
  await expect(page.locator(".representative-occurrences li")).toHaveCount(3);
  await expect(page.getByTestId("contact-pattern-save")).toBeEnabled();
  await expectNoDocumentHorizontalOverflow(page);

  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="page-contact"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
  ).toEqual([]);

  await page.getByTestId("contact-pattern-save").click();
  await expect(page.getByTestId("contact-message")).toContainText("Betreuungsserie gespeichert");
  const entriesResponse = await page.request.get("/api/care-entries");
  expect(entriesResponse.ok(), await entriesResponse.text()).toBe(true);
  const recurringEntry = (await entriesResponse.json() as Array<{
    id: string;
    generatedByPatternId?: string;
    startDateTime: string;
  }>).find((entry) => entry.generatedByPatternId);
  expect(recurringEntry).toBeTruthy();

  await navigate(page, "calendar");
  await page.getByTestId("month-picker").fill(recurringEntry!.startDateTime.slice(0, 7));
  const entryTrigger = mobile
    ? page.getByTestId(`agenda-entry-${recurringEntry!.id}`).first()
    : page.getByTestId(`calendar-entry-${recurringEntry!.id}`).first();
  await entryTrigger.click();
  const scopeChoice = page.getByTestId("rule-entry-edit-choice");
  await expect(scopeChoice).toBeVisible();
  await expect(scopeChoice.getByTestId("rule-entry-scope-occurrence")).toBeVisible();
  await expect(scopeChoice.getByTestId("rule-entry-scope-following")).toBeVisible();
  await expect(scopeChoice.getByTestId("rule-entry-scope-series")).toBeVisible();
  await expect(page.getByRole("dialog").locator(":focus")).toHaveCount(1);
  await expectNoDocumentHorizontalOverflow(page);
  const scopeAccessibility = await new AxeBuilder({ page })
    .include('[data-testid="rule-entry-edit-choice"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    scopeAccessibility.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))
  ).toEqual([]);

  await scopeChoice.getByTestId("rule-entry-scope-following").click();
  const followingForm = page.getByTestId("recurring-care-series-form");
  await expect(followingForm).toBeVisible();
  await expect(page.getByRole("heading", { name: "Diesen und folgende Termine ändern" })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(entryTrigger).toBeFocused();
});
