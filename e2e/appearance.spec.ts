import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow, navigate, openApp, type AppPage } from "./helpers";
import { fixedNow, seedVisualFixture, stabilizeRuntimeResponses, stabilizeRendering } from "./visual-fixture";

test.beforeEach(async ({ page, request }) => {
  await seedVisualFixture(request);
  await page.clock.setFixedTime(new Date(fixedNow));
  await stabilizeRuntimeResponses(page);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

async function expectAccessible(page: Page, state: string) {
  // WebKit can resolve inherited foregrounds after the root color-scheme changes.
  const foreground = await page.locator("body").evaluate(element => getComputedStyle(element).color);
  for (const heading of await page.locator("h1, .panel__header h2, .modal__header h2").all()) {
    await expect(heading).toHaveCSS("color", foreground);
  }
  const previousForeground = foreground === "rgb(20, 33, 61)" ? "rgb(237, 240, 242)" : "rgb(20, 33, 61)";
  await expect.poll(() => page.locator("body *").evaluateAll((elements, previous) => elements
    .filter(element => element instanceof HTMLElement &&
      element.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }) &&
      Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) &&
      getComputedStyle(element).color === previous)
    .map(element => element.tagName), previousForeground), { message: `${state}: inherited text has updated` }).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter(v => v.impact === "critical" || v.impact === "serious").map(v => ({
    id: v.id, nodes: v.nodes.map(n => ({ target: n.target, reason: n.failureSummary }))
  })), state).toEqual([]);
}

test("applies local appearance before startup and follows explicit and system changes", async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  let blockedAppLoads = 0;
  await page.route("**/assets/index-*.js", route => { blockedAppLoads++; return route.abort(); });
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("upgrade-insecure-requests");
  expect(blockedAppLoads).toBeGreaterThan(0);
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 29, 32)");
  await page.unroute("**/assets/index-*.js");
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await navigate(page, "settings");
  const control = page.getByTestId("appearance-control");
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    const language = await page.getByTestId("settings-language").boundingBox();
    const appearance = await control.getByRole("group").boundingBox();
    expect(Math.abs(language!.y - appearance!.y)).toBeLessThanOrEqual(1);
  }
  await expect(control.getByRole("button", { name: "System", exact: true })).toHaveAttribute("aria-pressed", "true");
  await control.getByRole("button", { name: "Hell", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await page.reload();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  const other = await context.newPage();
  await other.goto("/datenschutz");
  await expect(other.locator("html")).toHaveAttribute("data-appearance", "light");
  await navigate(page, "settings");
  await control.getByRole("button", { name: "Dunkel", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(other.locator("html")).toHaveAttribute("data-appearance", "dark");
  await control.getByRole("button", { name: "System", exact: true }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#191d20");
  await expectNoDocumentHorizontalOverflow(page);
  await other.close();
});

test("keeps dark routes readable and print colors light", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const children = await (await page.request.get("/api/children")).json() as Array<{ id: string }>;
  const parties = await (await page.request.get("/api/care-parties")).json() as Array<{ id: string }>;
  for (const [index, status] of ["planned", "partial", "cancelled", "planned"].entries()) {
    const day = index === 3 ? "08" : String(8 + index).padStart(2, "0");
    const data = {
      status, childIds: [children[0].id], responsiblePartyId: parties[index === 3 ? 1 : 0].id,
      startDateTime: `2026-09-${day}T08:00`, endDateTime: `2026-09-${day}T18:00`,
      cancellationReason: status === "cancelled" ? "Fiktiver Ausfallgrund" : undefined,
      ...(status === "partial" ? {
        actualChildIds: [children[0].id], actualStartDateTime: `2026-09-${day}T10:00`,
        actualEndDateTime: `2026-09-${day}T14:00`
      } : {})
    };
    let result = await page.request.post("/api/care-entries", { data });
    if (index === 3) {
      expect(result.status()).toBe(409);
      const preview = await result.json() as { fingerprint: string };
      result = await page.request.post("/api/care-entries", {
        data: { ...data, confirmPlannedConflict: true, conflictFingerprint: preview.fingerprint }
      });
    }
    expect(result.ok(), await result.text()).toBe(true);
  }
  const unavailable = await page.request.post("/api/unavailable-periods", { data: {
    startDateTime: "2026-09-11T08:00", endDateTime: "2026-09-11T18:00",
    category: "duty", dutyRelated: true, affectsContact: true, affectsHolidays: false,
    notes: "Fiktive Nichtverfuegbarkeit", hasEvidence: false
  } });
  expect(unavailable.ok(), await unavailable.text()).toBe(true);
  await openApp(page);
  const routes: AppPage[] = ["dashboard", "calendar", "settings", "backup", "report", "analytics", "rules", "contact", "unavailable"];
  for (const route of routes) {
    await navigate(page, route);
    if (route === "report") {
      await expect(page.getByTestId("page-report").locator('input[type="month"]')).toHaveValue("2026-09");
      await expect(page.getByText("BK-20260902-VISUAL01")).toBeVisible();
    }
    await expectNoDocumentHorizontalOverflow(page);
    await expectAccessible(page, `${route} in dark mode`);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-appearance", "light");
    await expect(page.locator("body")).toHaveCSS("color", "rgb(20, 33, 61)");
    await expectAccessible(page, `${route} in light mode`);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
    await expect(page.locator("body")).toHaveCSS("color", "rgb(237, 240, 242)");
    if (route === "analytics") {
      const table = page.getByRole("region", { name: "Auswertung je Kind und gemeinsam" });
      await table.scrollIntoViewIfNeeded();
      await table.focus();
      await expect(table).toBeFocused();
      if (await table.evaluate(element => element.scrollWidth > element.clientWidth)) {
        await page.keyboard.press("ArrowRight", { delay: 100 });
        await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      }
    }
    if (["dashboard", "calendar", "settings", "report"].includes(route)) {
      await stabilizeRendering(page);
      await page.screenshot({ path: testInfo.outputPath(`dark-${route}.png`), fullPage: true, animations: "disabled" });
      if (testInfo.project.name.startsWith("visual-")) {
        if (route === "report") {
          // Native month labels differ between Chromium builds; use the existing annual reference state.
          const annualSnapshot = page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname === "/api/reports/snapshot" &&
              url.searchParams.get("startDate") === "2026-01-01" &&
              url.searchParams.get("endDate") === "2026-12-31";
          });
          await page.getByTestId("page-report").getByRole("button", { name: "Jahr", exact: true }).click();
          expect((await annualSnapshot).ok()).toBe(true);
          await expect(page.getByTestId("page-report").locator('input[type="number"]')).toHaveValue("2026");
          await expect(page.getByText("BK-20260902-VISUAL01")).toBeVisible();
          await expect(page.getByTestId("page-report").getByRole("button", { name: "Drucken", exact: true })).toBeEnabled();
          await expectAccessible(page, "annual report in dark mode");
          await stabilizeRendering(page);
        }
        await expect(page).toHaveScreenshot(`dark-${route}.png`, { animations: "disabled", caret: "hide" });
      }
    }
  }
  for (const route of ["/impressum", "/datenschutz"]) {
    await page.goto(route);
    await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(36, 41, 46)");
    await expectNoDocumentHorizontalOverflow(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter(v => v.impact === "critical" || v.impact === "serious")).toEqual([]);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("main")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await page.emulateMedia({ media: "screen" });
  }
  await openApp(page);
  await navigate(page, "report");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light only");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`keeps dialogs, invalid fields and focus readable in ${colorScheme} mode`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await openApp(page);
    const mobile = page.getByTestId("mobile-entry-create");
    const trigger = await mobile.isVisible() ? mobile : page.getByTestId("dashboard-new-entry");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(":focus")).toHaveCount(1);
    expect(await dialog.locator(".modal__body").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const lastStatus = dialog.getByRole("radio", { name: "Ausgefallen", exact: true });
    await lastStatus.focus();
    await page.keyboard.press("Space");
    await expect(lastStatus).toBeChecked();
    await expect(lastStatus.locator("..")).toBeInViewport();
    await dialog.getByRole("radio", { name: "Durchgef\u00fchrt", exact: true }).focus();
    await page.keyboard.press("Space");
    await expectAccessible(page, `${colorScheme} entry dialog`);
    const help = dialog.locator(".field-help-button").first();
    await help.click();
    await expect(page.locator(".field-help-dialog")).toBeVisible();
    await expectAccessible(page, `${colorScheme} field help`);
    await page.keyboard.press("Escape");
    await expect(help).toBeFocused();
    const start = dialog.getByTestId("entry-start-date");
    const end = dialog.getByTestId("entry-end-date");
    await start.fill("2026-09-15");
    await end.fill("2026-09-14");
    await expect(end).toHaveAttribute("aria-invalid", "true");
    await expectAccessible(page, `${colorScheme} date validation`);
    await expectNoDocumentHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`${colorScheme}-entry-validation.png`), fullPage: false, animations: "disabled" });
    if (testInfo.project.name.startsWith("visual-")) {
      await expect(page).toHaveScreenshot(`${colorScheme}-entry-validation.png`, { animations: "disabled", caret: "hide" });
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}
