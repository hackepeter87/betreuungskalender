import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  navigate,
  openApp,
  resetApp
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("keeps the side navigation and month calendar usable", async ({ page }) => {
  const childName = "Noah Muster";
  await openApp(page);
  await expect(page.getByRole("navigation", {
    name: "Hauptnavigation"
  })).toBeVisible();
  await createChild(page, childName);
  await createEntry(page, {
    childName,
    startDay: 16,
    startTime: "17:30",
    endDay: 17,
    endTime: "08:00",
    note: "Fiktiver iPad-Eintrag",
    overnight: true
  });

  await navigate(page, "Kalender");
  await expect(page.locator(".calendar-panel--large")).toBeVisible();
  await expect(page.getByText(childName).first()).toBeVisible();
});
