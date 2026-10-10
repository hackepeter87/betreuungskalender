import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow, navigate, openApp, resetApp } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await resetApp(page.request);
  const response = await page.request.post("/api/children", {
    data: {
      name: "Fiktives Datenschutzprofil",
      birthMonth: 4,
      birthYear: 2018,
      color: "#0f8b83"
    }
  });
  expect(response.ok(), await response.text()).toBe(true);
});

test("reviews and confirms an owner-only privacy action without layout or accessibility regressions", async ({ page }) => {
  await openApp(page);
  await navigate(page, "settings");

  const workflow = page.getByTestId("privacy-action-workflow");
  await expect(workflow).toBeVisible();
  await expect(workflow).toContainText("Keine automatische Rechtsentscheidung");

  const subject = workflow.getByTestId("privacy-subject");
  await expect(subject.locator("option")).toHaveCount(2);
  await subject.selectOption({ index: 1 });
  await workflow.getByTestId("privacy-action-access").selectOption("revoke");
  await workflow.getByTestId("privacy-action-preview").click();
  await expect(workflow.getByTestId("privacy-action-review")).toContainText("Ausführung blockiert");
  await expect(workflow.getByTestId("privacy-action-review")).toContainText("Owner ist geschützt");
  await expect(workflow.getByTestId("privacy-action-prepare")).toBeDisabled();

  await workflow.getByTestId("privacy-subject-type").selectOption("child");
  await workflow.getByTestId("privacy-subject").selectOption({ label: "Fiktives Datenschutzprofil" });
  await workflow.getByTestId("privacy-action-profile").selectOption("anonymize");
  await workflow.getByTestId("privacy-action-historical_attribution").selectOption("anonymize");
  await workflow.getByTestId("privacy-action-preview").click();

  const review = workflow.getByTestId("privacy-action-review");
  await expect(review).toBeVisible();
  await expect(review).toContainText("Zur Bestätigung bereit");
  await expect(review).toContainText("Sicherungen und wiederhergestellte Kopien");
  await expectNoDocumentHorizontalOverflow(page);

  const workflowAccessibility = await new AxeBuilder({ page })
    .include('[data-testid="privacy-action-workflow"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(workflowAccessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious"))
    .toEqual([]);

  const prepare = workflow.getByTestId("privacy-action-prepare");
  await prepare.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await expectNoDocumentHorizontalOverflow(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(prepare).toBeFocused();

  await prepare.click();
  await dialog.getByTestId("privacy-action-confirm-checkbox").check();
  await dialog.getByTestId("privacy-action-execute").click();
  await expect(dialog).toBeHidden();
  await expect(workflow.getByTestId("privacy-action-result")).toBeVisible();
  await expect(workflow).toContainText("Maßnahme abgeschlossen");
  await expectNoDocumentHorizontalOverflow(page);
});
