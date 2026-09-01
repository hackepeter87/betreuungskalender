import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import Fastify from "fastify";
import type { ApiAppSettings } from "../shared/api.js";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "betreuungskalender-settings-"));
process.env.DATABASE_PATH = join(temporaryDirectory, "test.sqlite");
process.env.BACKUP_DIR = join(temporaryDirectory, "backups");

const { runMigrations } = await import("./db/migrate.js");
const { db } = await import("./db/connection.js");
const { clearDomainData, importData } = await import("./routes/appData.js");
const { settingsRoutes } = await import("./routes/settings.js");
const { createEdgeCaseDemoData } = await import("./services/demoFixtures.js");
const { getClientSettings } = await import("./services/settings.js");
const { settingsInputSchema } = await import("./validation/schemas.js");

runMigrations();

const timestamp = "2026-09-01T10:00:00.000Z";

function insertCareParty(id: string, deleted = false): void {
  db.prepare(`
    INSERT INTO care_parties (
      id, name, kind, created_by, updated_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, 'other', 'settings-test', 'settings-test', ?, ?, ?)
  `).run(id, id, timestamp, timestamp, deleted ? timestamp : null);
}

function insertSetting(key: string, valueJson: string): void {
  db.prepare(`
    INSERT INTO settings (
      key, value_json, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, 'settings-test', 'settings-test', ?, ?)
  `).run(key, valueJson, timestamp, timestamp);
}

async function app() {
  const instance = Fastify();
  instance.addHook("onRequest", async (request) => {
    request.userEmail = "settings-test";
  });
  await settingsRoutes(instance);
  return instance;
}

beforeEach(() => {
  clearDomainData(db);
});

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("client settings discard invalid historical values and internal keys", () => {
  insertCareParty("party-active");
  insertCareParty("party-deleted", true);
  insertSetting("kilometerRate", "-1");
  insertSetting("defaultLocation", '"invalid"');
  insertSetting("defaultHandoverFrom", '"school"');
  insertSetting("defaultHandoverTo", "not-json");
  insertSetting("primaryCarePartyId", '"party-active"');
  insertSetting("defaultResponsiblePartyId", '"party-deleted"');
  insertSetting("rhythmStartDate", '"2026-02-30"');
  insertSetting("lastJsonBackupAt", '"not-a-timestamp"');
  insertSetting("unknownFeature", "true");
  insertSetting("setup.installationLabel", '"Private installation"');

  assert.deepEqual(getClientSettings(), {
    kilometerRate: 0.3,
    defaultLocation: "commuterApartment",
    defaultHandoverFrom: "school",
    defaultHandoverTo: "mother",
    primaryCarePartyId: "party-active"
  });
});

test("settings endpoint accepts the complete writable contract", async () => {
  insertCareParty("party-primary");
  insertCareParty("party-default");
  const instance = await app();
  const expected: ApiAppSettings = {
    kilometerRate: 0.42,
    defaultLocation: "mainResidence",
    defaultHandoverFrom: "father",
    defaultHandoverTo: "school",
    primaryCarePartyId: "party-primary",
    defaultResponsiblePartyId: "party-default",
    rhythmStartDate: "2026-09-04",
    lastJsonBackupAt: "2026-09-01T12:30:00.000Z"
  };

  const response = await instance.inject({
    method: "PUT",
    url: "/api/settings",
    payload: expected
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), expected);
  assert.deepEqual(getClientSettings(), expected);
  await instance.close();
});

test("settings endpoint rejects unknown keys, invalid values, and inactive references", async () => {
  insertCareParty("party-active");
  insertCareParty("party-deleted", true);
  const instance = await app();
  const invalidPayloads: Array<Record<string, unknown>> = [
    { unknownFeature: true },
    { "setup.installationLabel": "Private installation" },
    { kilometerRate: -0.01 },
    { kilometerRate: null },
    { defaultLocation: "invalid" },
    { defaultHandoverFrom: "invalid" },
    { defaultHandoverTo: "invalid" },
    { primaryCarePartyId: "party-missing" },
    { defaultResponsiblePartyId: "party-deleted" },
    { rhythmStartDate: "2026-02-30" },
    { lastJsonBackupAt: "2026-09-01" }
  ];

  for (const payload of invalidPayloads) {
    const response = await instance.inject({
      method: "PUT",
      url: "/api/settings",
      payload
    });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(getClientSettings(), {
    kilometerRate: 0.3,
    defaultLocation: "commuterApartment",
    defaultHandoverFrom: "mother",
    defaultHandoverTo: "mother"
  });
  await instance.close();
});

test("settings schema rejects non-finite numeric values", () => {
  assert.equal(settingsInputSchema.safeParse({ kilometerRate: Number.NaN }).success, false);
  assert.equal(settingsInputSchema.safeParse({ kilometerRate: Number.POSITIVE_INFINITY }).success, false);
});

test("legacy backups keep valid settings from the nested settings object", () => {
  const data = createEdgeCaseDemoData();
  data.lastJsonBackupAt = undefined;
  data.settings.lastJsonBackupAt = "2026-08-31T18:00:00.000Z";

  db.transaction(() => importData(data, "settings-test", db))();

  assert.equal(getClientSettings().lastJsonBackupAt, "2026-08-31T18:00:00.000Z");
});
