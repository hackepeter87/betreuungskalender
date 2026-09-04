import { expect, test } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow, navigate, openApp } from "./helpers";
import { fixedNow, seedVisualFixture, stabilizeRendering, stabilizeRuntimeResponses } from "./visual-fixture";

test.beforeEach(async ({ page, request }) => {
  await seedVisualFixture(request);
  await page.clock.setFixedTime(new Date(fixedNow));
  await stabilizeRuntimeResponses(page);
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`keeps tablet navigation labels and report geometry readable in ${colorScheme}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await openApp(page);
    for (const width of [768, 834, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1024 });
      await navigate(page, "report");
      await expect(page.getByText("BK-20260902-VISUAL01")).toBeVisible();
      await stabilizeRendering(page);
      const clippedLabels = await page.locator(".sidebar__nav").evaluate(nav => {
        const boundary = nav.getBoundingClientRect();
        return Array.from(nav.querySelectorAll("button span")).filter(label => {
          const range = document.createRange();
          range.selectNodeContents(label);
          return Array.from(range.getClientRects()).some(rect => rect.left < boundary.left || rect.right > boundary.left + nav.clientWidth + 1);
        }).map(label => label.textContent);
      });
      expect.soft(clippedLabels, `${width}: complete navigation labels`).toEqual([]);
      await expect(page.getByTestId("nav-unavailable")).toHaveAccessibleName("Nichtverf\u00fcgbarkeit");
      for (const icon of await page.locator(".sidebar__nav button svg").all()) {
        expect.soft((await icon.boundingBox())!.width, `${width}: icon width`).toBeGreaterThanOrEqual(18);
      }
      for (const period of ["Monat", "Jahr"]) {
        const report = page.getByTestId("page-report");
        const mode = report.getByRole("button", { name: period, exact: true });
        if (!(await mode.getAttribute("class"))?.includes("is-active")) {
          const snapshot = page.waitForResponse(response => response.url().includes("/api/reports/snapshot"));
          await mode.click();
          expect((await snapshot).ok()).toBe(true);
        }
        await expect(report.getByRole("button", { name: "Drucken", exact: true })).toBeEnabled();
        const violations = await page.locator(".report-document__header").evaluate(header => {
          const metadata = header.querySelector("dl")!.getBoundingClientRect();
          const boundary = header.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(header.querySelector("h1")!);
          return Array.from(range.getClientRects()).filter(rect =>
            rect.right > boundary.right + 1 || rect.left < boundary.left - 1 ||
            (rect.left < metadata.right && rect.right > metadata.left && rect.top < metadata.bottom && rect.bottom > metadata.top)
          ).length;
        });
        expect.soft(violations, `${width}/${period}: title fits without metadata overlap`).toBe(0);
        const splitWords = await report.locator(".report-table th, .report-table td").evaluateAll(headings => headings.flatMap(heading => {
          const node = heading.firstChild;
          if (!node || node.nodeType !== Node.TEXT_NODE) return [];
          return Array.from((node.textContent ?? "").matchAll(/\S+/g)).filter(match => {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            return range.getClientRects().length > 1;
          }).map(match => match[0]);
        }));
        expect.soft(splitWords, `${width}/${period}: table text retains whole words`).toEqual([]);
        for (const table of await report.locator(".table-scroll").all()) {
          await expect(table).toHaveRole("region");
          await expect(table).toHaveAttribute("aria-label", /.+/);
          await table.focus();
          await expect(table).toBeFocused();
          if (await table.evaluate(element => element.scrollWidth > element.clientWidth)) {
            await page.keyboard.press("Home");
            await table.evaluate(element => { element.scrollLeft = 0; });
            await page.keyboard.press("ArrowRight", { delay: 100 });
            await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
            await table.evaluate(element => { element.scrollLeft = 0; });
          }
        }
      }
      await expectNoDocumentHorizontalOverflow(page);
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      await stabilizeRendering(page);
      await page.screenshot({ path: testInfo.outputPath(`${colorScheme}-report-${width}.png`), fullPage: true });
      await page.emulateMedia({ media: "print" });
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
      const printLayout = await page.getByTestId("report-document").evaluate(document => {
        const columns = (selector: string) => getComputedStyle(document.querySelector(selector)!).gridTemplateColumns.split(" ").length;
        return {
          headerColumns: columns(".report-document__header"),
          summaryColumns: columns(".report-summary-grid"),
          tablesFit: Array.from(document.querySelectorAll("table")).every(table => table.getBoundingClientRect().width <= document.clientWidth + 1)
        };
      });
      expect(printLayout).toEqual({ headerColumns: 2, summaryColumns: 2, tablesFit: true });
      await page.emulateMedia({ media: "screen" });
      const collapse = page.getByTestId("sidebar-collapse-control");
      await collapse.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".sidebar")).toHaveClass(/sidebar--collapsed/);
      await page.getByTestId("nav-calendar").focus();
      await expect(page.getByTestId("nav-calendar")).toHaveAccessibleName("Kalender");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("page-calendar")).toBeVisible();
      await collapse.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar--collapsed/);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("mobile-nav-more").click();
    await expect(page.getByTestId("mobile-more-unavailable")).toHaveAccessibleName("Nichtverf\u00fcgbarkeit");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mobile-nav-more")).toBeFocused();
  });
}
