import { expect, type APIRequestContext, type Page } from "@playwright/test";

export function dateInCurrentMonth(day: number): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0")
  ].join("-");
}

export async function resetApp(request: APIRequestContext) {
  const response = await request.delete("/api/app-data");
  expect(response.ok()).toBeTruthy();
}

export async function openApp(page: Page) {
  await page.goto("/");
  await expect(page).toHaveTitle(/Betreuungskalender/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Daten werden aus SQLite geladen …")).toBeHidden();
}

export async function navigate(page: Page, destination: string) {
  const mobileNavigation = page.getByRole("navigation", {
    name: "Mobile Navigation"
  });
  if (await mobileNavigation.isVisible()) {
    const directButton = mobileNavigation.getByRole("button", {
      name: destination,
      exact: true
    });
    if (await directButton.count()) {
      await directButton.click();
      return;
    }
    await mobileNavigation.getByRole("button", {
      name: "Weitere Bereiche öffnen"
    }).click();
    await page.getByRole("dialog", { name: "Weitere Bereiche" })
      .getByRole("button", { name: destination, exact: true })
      .click();
    return;
  }

  const mainNavigation = page.getByRole("navigation", {
    name: "Hauptnavigation"
  });
  const navigationButton = mainNavigation.getByRole("button", {
    name: destination,
    exact: true
  });
  if (await navigationButton.count()) {
    await navigationButton.click();
    return;
  }

  await page.getByRole("button", {
    name: destination,
    exact: true
  }).click();
}

export async function createChild(page: Page, name: string) {
  await page.getByRole("button", { name: "Kind anlegen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await page.getByRole("button", { name: "Kind anlegen", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Kind anlegen" });
  await dialog.getByPlaceholder("Vorname oder Kürzel").fill(name);
  await dialog.getByRole("button", { name: "Kind anlegen", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

type EntryOptions = {
  childName: string;
  startDay: number;
  startTime: string;
  endDay: number;
  endTime: string;
  note: string;
  overnight?: boolean;
  withTripAndCost?: boolean;
};

export async function createEntry(page: Page, options: EntryOptions) {
  await navigate(page, "Kalender");
  const mobileAddButton = page.getByRole("button", {
    name: "Betreuungseintrag hinzufügen"
  });
  if (await mobileAddButton.isVisible()) {
    await mobileAddButton.click();
  } else {
    await page.getByRole("button", {
      name: `Eintrag am ${dateInCurrentMonth(options.startDay)} erfassen`
    }).first().click();
  }
  const dialog = page.getByRole("dialog", {
    name: "Betreuungseintrag erfassen"
  });

  await dialog.getByRole("checkbox", { name: options.childName }).check();
  const dateInputs = dialog.locator('input[type="date"]');
  const timeInputs = dialog.locator('input[type="time"]');
  await dateInputs.nth(0).fill(dateInCurrentMonth(options.startDay));
  await timeInputs.nth(0).fill(options.startTime);
  await dateInputs.nth(1).fill(dateInCurrentMonth(options.endDay));
  await timeInputs.nth(1).fill(options.endTime);

  if (options.overnight) {
    await dialog.getByRole("checkbox", { name: /Übernachtung/ })
      .check({ force: true });
  }

  if (options.withTripAndCost) {
    await dialog.getByText("Fahrten", { exact: true }).click();
    await dialog.getByRole("button", { name: "Fahrt", exact: true }).click();
    await dialog.locator(".line-item").filter({ hasText: "Fahrt 1" })
      .locator('input[type="number"]')
      .first()
      .fill("18.5");

    await dialog.locator("summary").filter({ hasText: /^Kosten/ }).click();
    await dialog.getByRole("button", { name: "Kosten", exact: true }).click();
    await dialog.locator(".line-item").filter({ hasText: "Kostenposten 1" })
      .locator('input[type="number"]')
      .first()
      .fill("12.40");
  }

  await dialog.getByText("Notizen und Belege", { exact: true }).click();
  await dialog.getByPlaceholder(
    "Sachliche Hinweise zu Übergabe, Ablauf oder Abweichungen"
  ).fill(options.note);
  const saveButton = dialog.getByRole("button", { name: "Eintrag speichern" });
  await saveButton.click();
  await expect(dialog).toBeHidden();
}

export async function createHoliday(page: Page, childName: string) {
  await navigate(page, "Ferien");
  await expect(page.getByRole("heading", { name: "Ferienverwaltung" })).toBeVisible();
  await page.getByRole("button", { name: "Ferienblock erfassen" }).click();

  const dialog = page.getByRole("dialog", { name: "Ferienblock erfassen" });
  await dialog.getByPlaceholder("z. B. Sommerferien Block 1")
    .fill("Fiktiver Ferienblock");
  const dates = dialog.locator('input[type="date"]');
  await dates.nth(0).fill(dateInCurrentMonth(20));
  await dates.nth(1).fill(dateInCurrentMonth(22));
  await expect(dialog.getByRole("checkbox", { name: childName })).toBeChecked();
  await dialog.getByRole("button", {
    name: "Ferienblock speichern"
  }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Fiktiver Ferienblock", { exact: true })).toBeVisible();
}
