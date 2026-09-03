import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  navigate,
  openApp,
  resetApp,
  type AppPage
} from "./helpers";

const fixedNow = "2026-09-02T10:00:00.000Z";
const fixedMetadataTime = "2026-09-01T08:00:00.000Z";

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(response.ok(), await response.text()).toBe(true);
}

async function seedVisualFixture(request: APIRequestContext) {
  await resetApp(request);

  const partiesResponse = await request.get("/api/care-parties");
  expect(partiesResponse.ok()).toBe(true);
  const parties = await partiesResponse.json() as Array<{ id: string; name: string }>;
  const primary = parties.find((party) => party.name === "Hauptbetreuung");
  expect(primary).toBeTruthy();

  const secondaryResponse = await request.post("/api/care-parties", {
    data: { name: "Betreuung Beispiel", kind: "other" }
  });
  await expectOk(secondaryResponse);
  const secondary = await secondaryResponse.json() as { id: string };

  const children = await Promise.all([
    request.post("/api/children", {
      data: { name: "Fiktives Kind A", birthMonth: 4, birthYear: 2017, color: "#0f8b83" }
    }),
    request.post("/api/children", {
      data: { name: "Fiktives Kind B", birthMonth: 9, birthYear: 2020, color: "#2f6fed" }
    })
  ]);
  for (const response of children) await expectOk(response);
  const childIds = (await Promise.all(children.map(async (response) =>
    (await response.json() as { id: string }).id
  ))).sort((left, right) => left.localeCompare(right));
  const [alexId, samId] = childIds;
  expect(alexId).toBeTruthy();
  expect(samId).toBeTruthy();
  const renamedChildren = await Promise.all([
    request.put(`/api/children/${alexId}`, {
      data: { name: "Alex Beispiel", birthMonth: 4, birthYear: 2017, color: "#0f8b83" }
    }),
    request.put(`/api/children/${samId}`, {
      data: { name: "Sam Muster", birthMonth: 9, birthYear: 2020, color: "#2f6fed" }
    })
  ]);
  for (const response of renamedChildren) expect(response.ok()).toBe(true);

  const commonEntry = {
    status: "completed",
    careScope: "full_day",
    overnight: false,
    schoolHandover: false,
    holiday: false,
    weekend: false,
    additionalCare: false,
    location: "other",
    handoverFrom: "mother",
    handoverTo: "mother",
    hasEvidence: false,
    trips: [],
    costs: []
  };
  const entries = await Promise.all([
    request.post("/api/care-entries", {
      data: {
        ...commonEntry,
        startDateTime: "2026-09-03T08:00",
        endDateTime: "2026-09-03T18:00",
        childIds: [alexId],
        responsiblePartyId: primary!.id,
        notes: "Fiktiver Betreuungstermin"
      }
    }),
    request.post("/api/care-entries", {
      data: {
        ...commonEntry,
        startDateTime: "2026-09-05T16:00",
        endDateTime: "2026-09-07T08:00",
        childIds: [alexId, samId],
        responsiblePartyId: secondary.id,
        overnight: true,
        notes: "Fiktives Wochenende"
      }
    })
  ]);
  for (const response of entries) await expectOk(response);

  const holidayResponse = await request.post("/api/holiday-periods", {
    data: {
      name: "Fiktive Herbstferien",
      startDate: "2026-09-14",
      endDate: "2026-09-18",
      childIds: [alexId, samId],
      assignedTo: "shared"
    }
  });
  await expectOk(holidayResponse);
}

function fixedMetadata(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(fixedMetadata);
  const record = { ...value } as Record<string, unknown>;
  for (const key of ["createdAt", "updatedAt"]) {
    if (typeof record[key] === "string") record[key] = fixedMetadataTime;
  }
  return record;
}

async function stabilizeRuntimeResponses(page: Page) {
  await page.route("**/api/data-transfer/actors", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      headers: { "cache-control": "no-store" },
      json: []
    });
  });

  for (const path of [
    "/api/children",
    "/api/care-parties",
    "/api/care-entries",
    "/api/holiday-periods"
  ]) {
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, json: fixedMetadata(await response.json()) });
    });
  }

  await page.route("**/api/instance-readiness", async (route) => {
    const response = await route.fetch();
    const readiness = await response.json() as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...readiness,
        instanceId: "inst_visual00000000",
        serverTime: fixedNow,
        version: "visual-test"
      }
    });
  });

  await page.route("**/api/reports/snapshot**", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json() as Record<string, unknown>;
    const data = fixedMetadata(snapshot.data) as Record<string, unknown>;
    if (Array.isArray(data.children)) {
      data.children = data.children.slice().sort((left, right) =>
        String((left as Record<string, unknown>).name).localeCompare(
          String((right as Record<string, unknown>).name),
          "de"
        )
      );
    }
    await route.fulfill({
      response,
      json: {
        ...snapshot,
        reportId: "BK-20260902-VISUAL01",
        generatedAt: fixedNow,
        dataUpdatedAt: fixedMetadataTime,
        data
      }
    });
  });
}

async function stabilizeRendering(page: Page) {
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation-delay: 0s !important;
      animation-duration: 0s !important;
      caret-color: transparent !important;
      scroll-behavior: auto !important;
      transition-delay: 0s !important;
      transition-duration: 0s !important;
    }
  ` });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

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
