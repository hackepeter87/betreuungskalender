import { expect, test } from "@playwright/test";
import {
  createChild,
  createEntry,
  createHoliday,
  navigate,
  openApp,
  resetApp
} from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetApp(request);
});

test("covers the core documentation and export flows", async ({ page }) => {
  const childName = "Alex Beispiel";
  await openApp(page);
  await createChild(page, childName);

  await createEntry(page, {
    childName,
    startDay: 8,
    startTime: "09:00",
    endDay: 8,
    endTime: "15:00",
    note: "Fiktiver regulärer Betreuungseintrag"
  });
  await createEntry(page, {
    childName,
    startDay: 10,
    startTime: "15:00",
    endDay: 10,
    endTime: "17:00",
    note: "Fiktive stundenweise Betreuung",
    withTripAndCost: true
  });
  await createEntry(page, {
    childName,
    startDay: 12,
    startTime: "17:00",
    endDay: 13,
    endTime: "08:00",
    note: "Fiktive Übernachtungsbetreuung",
    overnight: true
  });

  await navigate(page, "Einträge");
  await expect(page.getByText(childName).first()).toBeVisible();
  await createHoliday(page, childName);

  await navigate(page, "Bericht");
  await expect(page.getByRole("heading", {
    name: "Bericht & Druckansicht"
  })).toBeVisible();
  await expect(page.getByText(childName).first()).toBeVisible();
  await expect(page.getByText("18.5 km").first()).toBeVisible();
  await expect(page.getByText("12,40 €").first()).toBeVisible();

  await navigate(page, "Backup");
  await expect(page.getByRole("heading", { name: "Export & Import" })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "CSV-Rohdatenexport"
  })).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Betreuungseinträge"
  })).toBeVisible();
});
