import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { resetApp } from "./helpers";

export const fixedNow = "2026-09-02T10:00:00.000Z";
const fixedMetadataTime = "2026-09-01T08:00:00.000Z";

async function expectOk(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  expect(response.ok(), await response.text()).toBe(true);
}

export async function seedVisualFixture(request: APIRequestContext) {
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

export async function stabilizeRuntimeResponses(page: Page) {
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

export async function stabilizeRendering(page: Page) {
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
