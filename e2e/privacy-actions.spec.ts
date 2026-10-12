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
  await expect(workflow).not.toContainText("Keine automatische Rechtsentscheidung");
  await workflow.getByTestId("privacy-action-open").click();
  const workflowDialog = page.getByRole("dialog");
  await expect(workflowDialog).toContainText("Keine automatische Rechtsentscheidung");

  const subject = workflowDialog.getByTestId("privacy-subject");
  await expect(subject.locator("option")).toHaveCount(2);
  await subject.selectOption({ index: 1 });
  await workflowDialog.getByTestId("privacy-action-access").selectOption("revoke");
  await workflowDialog.getByTestId("privacy-action-preview").click();
  await expect(workflowDialog.getByTestId("privacy-action-review")).toContainText("Ausführung blockiert");
  await expect(workflowDialog.getByTestId("privacy-action-review")).toContainText("Owner ist geschützt");
  await expect(workflowDialog.getByTestId("privacy-action-prepare")).toBeDisabled();

  await workflowDialog.getByTestId("privacy-subject-type").selectOption("child");
  await workflowDialog.getByTestId("privacy-subject").selectOption({ label: "Fiktives Datenschutzprofil" });
  await workflowDialog.getByTestId("privacy-action-profile").selectOption("anonymize");
  await workflowDialog.getByTestId("privacy-action-historical_attribution").selectOption("anonymize");
  await workflowDialog.getByTestId("privacy-action-preview").click();

  const review = workflowDialog.getByTestId("privacy-action-review");
  await expect(review).toBeVisible();
  await expect(review).toContainText("Zur Bestätigung bereit");
  await expect(review).toContainText("Sicherungen und wiederhergestellte Kopien");
  await expectNoDocumentHorizontalOverflow(page);

  const workflowAccessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(workflowAccessibility.violations.filter(({ impact }) => impact === "critical" || impact === "serious"))
    .toEqual([]);

  const prepare = workflowDialog.getByTestId("privacy-action-prepare");
  await prepare.click();
  await expect(workflowDialog).toContainText("Datenschutzmaßnahme bestätigen");
  await expect(workflowDialog.locator(":focus")).toHaveCount(1);
  await expectNoDocumentHorizontalOverflow(page);
  await workflowDialog.getByText("Abbrechen", { exact: true }).click();
  await expect(workflowDialog).toContainText("Prüfergebnis");
  await workflowDialog.getByTestId("privacy-action-prepare").click();
  await workflowDialog.getByTestId("privacy-action-confirm-checkbox").check();
  await workflowDialog.getByTestId("privacy-action-execute").click();
  await expect(workflowDialog.getByTestId("privacy-action-result")).toBeVisible();
  await expect(workflowDialog).toContainText("Maßnahme abgeschlossen");
  await expectNoDocumentHorizontalOverflow(page);
});
