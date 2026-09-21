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

});
