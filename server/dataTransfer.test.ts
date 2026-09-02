import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { importData } from "./routes/appData.js";
import { dataTransferRoutes } from "./routes/dataTransfer.js";
import { createEdgeCaseDemoData } from "./services/demoFixtures.js";
import {
  createPortableTransfer,
  dryRunPortableTransfer,
  importPortableTransfer
} from "./services/dataTransfer.js";
import { getClientSettings } from "./services/settings.js";

async function database() {
  const result = createSqlitePersistenceRuntime(":memory:");
  await result.migrate();
  return result;
}

test("portable transfer dry run validates through the import core without target writes", async () => {
  const source = await database();
  const target = await database();
  try {
    await source.transaction((database) => importData(createEdgeCaseDemoData(), "fixture-actor", database));
    source.sqliteDatabase.prepare(`
      INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
      VALUES ('unknownHistoricalSetting', 'true', 'fixture-actor', 'fixture-actor', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    target.sqliteDatabase.prepare(`
      INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
      VALUES ('setup.ownerUserId', '"target-owner"', 'target-owner', 'target-owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    const transfer = await createPortableTransfer(source);
    const before = target.sqliteDatabase.serialize();
    const dryRun = await dryRunPortableTransfer(transfer, target);

    assert.equal(dryRun.result, "ready");
    assert.equal(dryRun.counts.children, 3);
    assert.equal(dryRun.exportedAt, transfer.exportedAt);
    assert.equal(dryRun.comparison.find((item) => item.category === "children")?.current, 0);
    assert.equal(dryRun.comparison.find((item) => item.category === "children")?.afterImport, 3);
    assert.equal(dryRun.checks.every((check) => check.status === "passed"), true);
    assert.equal(dryRun.summary.incomingRecords > 0, true);
    assert.equal(dryRun.actors.length > 0, true);
    assert.deepEqual(target.sqliteDatabase.serialize(), before);
    assert.equal(JSON.stringify(transfer).includes("external_subject"), false);
    assert.equal(JSON.stringify(transfer).includes("feed_url"), false);
    assert.equal("unknownHistoricalSetting" in transfer.data.settings, false);
    assert.equal(transfer.data.settings.rhythmStartDate, "2026-07-10");
    assert.equal(transfer.data.lastJsonBackupAt, "2026-07-01T09:30:00.000Z");
  } finally {
    await source.close();
    await target.close();
  }
});

test("portable transfer rejects excessive nesting and oversized text before import", async () => {
  const target = await database();
  let nested: unknown = "value";
  for (let index = 0; index < 30; index += 1) nested = { nested };
  try {
    await assert.rejects(dryRunPortableTransfer(nested, target), /deeply nested/);
    await assert.rejects(
      dryRunPortableTransfer({ value: "x".repeat(250_001) }, target),
      /oversized text/
    );
  } finally {
    await target.close();
  }
});

test("portable import requires the exact dry-run fingerprint and preserves target owner", async () => {
  const source = await database();
  const target = await database();
  try {
    await source.transaction((database) => importData(createEdgeCaseDemoData(), "fixture-actor", database));
    const transfer = await createPortableTransfer(source);
    const dryRun = await dryRunPortableTransfer(transfer, target);
    target.sqliteDatabase.prepare(`
      INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
      VALUES ('setup.ownerUserId', '"target-owner"', 'target-owner', 'target-owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();

    await assert.rejects(importPortableTransfer({
      package: transfer,
      fingerprint: "0".repeat(64),
      dryRunReceipt: dryRun.dryRunReceipt!,
      confirmWarnings: false,
      actorId: "target-owner"
    }, target), /differs from the tested package/);

    await importPortableTransfer({
      package: transfer,
      fingerprint: dryRun.fingerprint,
      dryRunReceipt: dryRun.dryRunReceipt!,
      confirmWarnings: false,
      actorId: "target-owner"
    }, target);

    assert.equal((target.sqliteDatabase.prepare("SELECT COUNT(*) AS count FROM children").get() as { count: number }).count, 3);
    assert.equal((target.sqliteDatabase.prepare("SELECT value_json AS value FROM settings WHERE key = 'setup.ownerUserId'").get() as { value: string }).value, '"target-owner"');
    assert.equal((target.sqliteDatabase.prepare("SELECT COUNT(*) AS count FROM data_transfer_actors").get() as { count: number }).count > 0, true);
    assert.deepEqual(await getClientSettings(target.query), {
      kilometerRate: 0.3,
      defaultLocation: "commuterApartment",
      defaultHandoverFrom: "mother",
      defaultHandoverTo: "mother",
      rhythmStartDate: "2026-07-10",
      lastJsonBackupAt: "2026-07-01T09:30:00.000Z"
    });
  } finally {
    await source.close();
    await target.close();
  }
});

test("portable import requires a receipt from the successful dry run", async () => {
  const source = await database();
  const target = await database();
  try {
    await source.transaction((database) => importData(createEdgeCaseDemoData(), "fixture-actor", database));
    const transfer = await createPortableTransfer(source);
    const dryRun = await dryRunPortableTransfer(transfer, target);
    await assert.rejects(importPortableTransfer({
      package: transfer,
      fingerprint: dryRun.fingerprint,
      dryRunReceipt: "invalid",
      confirmWarnings: false,
      actorId: "target-owner"
    }, target), /current successful dry run/);
  } finally {
    await source.close();
    await target.close();
  }
});

test("tampering with a portable package invalidates its checksum", async () => {
  const source = await database();
  try {
    await source.transaction((database) => importData(createEdgeCaseDemoData(), "fixture-actor", database));
    const transfer = await createPortableTransfer(source);
    transfer.data.children[0]!.name = "Changed after export";
    await assert.rejects(dryRunPortableTransfer(transfer, source), /checksum is invalid/);
  } finally {
    await source.close();
  }
});

test("legacy transfer warnings require explicit confirmation", async () => {
  const target = await database();
  try {
    const data = createEdgeCaseDemoData();
    const dryRun = await dryRunPortableTransfer(data, target);
    assert.equal(dryRun.result, "warnings");
    await assert.rejects(importPortableTransfer({
      package: data,
      fingerprint: dryRun.fingerprint,
      dryRunReceipt: dryRun.dryRunReceipt!,
      confirmWarnings: false,
      actorId: "target-owner"
    }, target), /must be confirmed/);
  } finally {
    await target.close();
  }
});

test("dry run blocks missing domain references", async () => {
  const target = await database();
  const data = createEdgeCaseDemoData();
  try {
    data.entries[0]!.childIds = ["missing-child"];
    const dryRun = await dryRunPortableTransfer(data, target);
    assert.equal(dryRun.result, "blocked");
    assert.deepEqual(dryRun.missingReferences, ["entry:child"]);
    assert.equal(dryRun.checks.find((check) => check.code === "references")?.status, "failed");
    assert.equal(dryRun.dryRunReceipt, undefined);
  } finally {
    await target.close();
  }
});

test("dry run compares the package with current target records without writing", async () => {
  const source = await database();
  const target = await database();
  try {
    await source.transaction((database) => importData(createEdgeCaseDemoData(), "fixture-actor", database));
    target.sqliteDatabase.prepare(`
      INSERT INTO children (id, name, birth_month, birth_year, color, created_at, updated_at)
      VALUES ('target-child', 'Target child', 1, 2018, '#0f8b8d', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    const before = target.sqliteDatabase.serialize();
    const dryRun = await dryRunPortableTransfer(await createPortableTransfer(source), target);
    const children = dryRun.comparison.find((item) => item.category === "children");
    assert.deepEqual(children, { category: "children", current: 1, incoming: 3, afterImport: 3 });
    assert.equal(dryRun.summary.currentRecords > 0, true);
    assert.deepEqual(target.sqliteDatabase.serialize(), before);
  } finally {
    await source.close();
    await target.close();
  }
});

test("portable transfer export and dry-run responses are not cached", async () => {
  const runtime = await database();
  const app = Fastify();
  app.decorate("persistence", runtime);
  app.addHook("onRequest", async (request) => {
    request.userEmail = "transfer-test";
  });
  await dataTransferRoutes(app);
  try {
    const exported = await app.inject({ method: "GET", url: "/api/data-transfer/export" });
    assert.equal(exported.statusCode, 200);
    assert.match(exported.headers["cache-control"] ?? "", /no-store/);

    const dryRun = await app.inject({
      method: "POST",
      url: "/api/data-transfer/dry-run",
      payload: exported.json()
    });
    assert.equal(dryRun.statusCode, 200);
    assert.match(dryRun.headers["cache-control"] ?? "", /no-store/);
  } finally {
    await app.close();
    await runtime.close();
  }
});
