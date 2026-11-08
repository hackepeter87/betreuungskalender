import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const projection = {
  mode: "shared_fictional_demo",
  seedVersion: "controlled-demo-v1",
  generatedAt: "2026-11-08T11:20:00.000Z",
  lifecycle: { nextResetAt: "2026-11-08T12:00:00.000Z" },
  children: [
    { id: "demo-child-a", name: "Demo-Kind A", color: "#087f7b" },
    { id: "demo-child-b", name: "<img src=x onerror=alert(1)>", color: "#2563eb" }
  ],
  careParties: [{ id: "demo-party-a", name: "Demo-Betreuung" }],
  entries: [{
    id: "demo-entry-a",
    startDateTime: "2026-11-09T15:00:00.000Z",
    endDateTime: "2026-11-09T19:00:00.000Z",
    status: "planned",
    careScope: "hourly",
    overnight: false,
    holiday: false,
    additionalCare: false,
    childIds: ["demo-child-a", "demo-child-b"],
    responsiblePartyId: "demo-party-a"
  }]
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/demo/public", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projection) });
  });
});

test("public demo explains shared data and remains accessible without horizontal overflow", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Fiktive Betreuungstermine ansehen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gemeinsamer Testbereich" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Als freigegebener Tester anmelden" })).toHaveAttribute("href", "/auth/login");
  await expect(page.getByText("<img src=x onerror=alert(1)>", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test("public demo warns in the final five minutes and fails closed when unavailable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "visual-390", "One deterministic lifecycle-state pass is sufficient.");
  await page.route("**/api/demo/public", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...projection,
        generatedAt: "2026-11-08T11:56:00.000Z"
      })
    });
  });
  await page.goto("/demo");
  await expect(page.getByRole("status")).toContainText("In weniger als fünf Minuten");

  await page.unroute("**/api/demo/public");
  await page.route("**/api/demo/public", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "demo_unavailable" }) });
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Demo vorübergehend nicht verfügbar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aktuelle Beispieldaten" })).toHaveCount(0);
});
