import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "./db/migrationRunner.js";
import { importData } from "./routes/appData.js";
import { createEdgeCaseDemoData } from "./services/demoFixtures.js";
import {
  createPortableTransfer,
  dryRunPortableTransfer,
  importPortableTransfer
} from "./services/dataTransfer.js";

function database(): Database.Database {
  const result = new Database(":memory:");
  result.pragma("foreign_keys = ON");
  migrateDatabase(result);
  return result;
}

function tableCounts(db: Database.Database): Record<string, number> {
  return Object.fromEntries([
    "children", "care_parties", "care_entries", "audit_log", "settings",
    "data_transfer_runs", "data_transfer_actors"
  ].map((table) => [
    table,
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  ]));
}

test("portable transfer dry run validates through the import core without target writes", () => {
  const source = database();
  const target = database();
  try {
    source.transaction(() => importData(createEdgeCaseDemoData(), "fixture-actor", source))();
    target.prepare(`
      INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
      VALUES ('setup.ownerUserId', '"target-owner"', 'target-owner', 'target-owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    const transfer = createPortableTransfer(source);
    const before = target.serialize();
    const dryRun = dryRunPortableTransfer(transfer, target);

    assert.equal(dryRun.result, "ready");
    assert.equal(dryRun.counts.children, 3);
    assert.equal(dryRun.exportedAt, transfer.exportedAt);
    assert.equal(dryRun.comparison.find((item) => item.category === "children")?.current, 0);
    assert.equal(dryRun.comparison.find((item) => item.category === "children")?.afterImport, 3);
    assert.equal(dryRun.checks.every((check) => check.status === "passed"), true);
    assert.equal(dryRun.summary.incomingRecords > 0, true);
    assert.equal(dryRun.actors.length > 0, true);
    assert.deepEqual(target.serialize(), before);
    assert.equal(JSON.stringify(transfer).includes("external_subject"), false);
    assert.equal(JSON.stringify(transfer).includes("feed_url"), false);
  } finally {
    source.close();
    target.close();
  }
});

test("portable transfer rejects excessive nesting and oversized text before import", () => {
  let nested: unknown = "value";
  for (let index = 0; index < 30; index += 1) nested = { nested };
  assert.throws(() => dryRunPortableTransfer(nested), /deeply nested/);
  assert.throws(() => dryRunPortableTransfer({ value: "x".repeat(250_001) }), /oversized text/);
});

test("portable import requires the exact dry-run fingerprint and preserves target owner", () => {
  const source = database();
  const target = database();
  try {
    source.transaction(() => importData(createEdgeCaseDemoData(), "fixture-actor", source))();
    const transfer = createPortableTransfer(source);
    const dryRun = dryRunPortableTransfer(transfer, target);
    target.prepare(`
      INSERT INTO settings (key, value_json, created_by, updated_by, created_at, updated_at)
      VALUES ('setup.ownerUserId', '"target-owner"', 'target-owner', 'target-owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();

    assert.throws(() => importPortableTransfer({
      package: transfer,
      fingerprint: "0".repeat(64),
      dryRunReceipt: dryRun.dryRunReceipt!,
      confirmWarnings: false,
      actorId: "target-owner"
    }, target), /differs from the tested package/);

    importPortableTransfer({
      package: transfer,
      fingerprint: dryRun.fingerprint,
      dryRunReceipt: dryRun.dryRunReceipt!,
      confirmWarnings: false,
      actorId: "target-owner"
    }, target);

    assert.equal((target.prepare("SELECT COUNT(*) AS count FROM children").get() as { count: number }).count, 3);
    assert.equal((target.prepare("SELECT value_json AS value FROM settings WHERE key = 'setup.ownerUserId'").get() as { value: string }).value, '"target-owner"');
    assert.equal((target.prepare("SELECT COUNT(*) AS count FROM data_transfer_actors").get() as { count: number }).count > 0, true);
  } finally {
    source.close();
    target.close();
  }
});

test("portable import requires a receipt from the successful dry run", () => {
  const source = database();
  const target = database();
  try {
    source.transaction(() => importData(createEdgeCaseDemoData(), "fixture-actor", source))();
    const transfer = createPortableTransfer(source);
    const dryRun = dryRunPortableTransfer(transfer, target);
    assert.throws(() => importPortableTransfer({
      package: transfer,
      fingerprint: dryRun.fingerprint,
      dryRunReceipt: "invalid",
      confirmWarnings: false,
      actorId: "target-owner"
    }, target), /current successful dry run/);
  } finally {
    source.close();
    target.close();
  }
});

test("tampering with a portable package invalidates its checksum", () => {
  const source = database();
  try {
    source.transaction(() => importData(createEdgeCaseDemoData(), "fixture-actor", source))();
    const transfer = createPortableTransfer(source);
    transfer.data.children[0]!.name = "Changed after export";
    assert.throws(() => dryRunPortableTransfer(transfer, source), /checksum is invalid/);
  } finally {
    source.close();
  }
});

test("legacy transfer warnings require explicit confirmation", () => {
  const target = database();
  try {
    const data = createEdgeCaseDemoData();
    const dryRun = dryRunPortableTransfer(data, target);
    assert.equal(dryRun.result, "warnings");
    assert.throws(() => importPortableTransfer({
      package: data,
      fingerprint: dryRun.fingerprint,
      dryRunReceipt: dryRun.dryRunReceipt!,
      confirmWarnings: false,
      actorId: "target-owner"
    }, target), /must be confirmed/);
  } finally {
    target.close();
  }
});

test("dry run blocks missing domain references", () => {
  const target = database();
  const data = createEdgeCaseDemoData();
  try {
    data.entries[0]!.childIds = ["missing-child"];
    const dryRun = dryRunPortableTransfer(data, target);
    assert.equal(dryRun.result, "blocked");
    assert.deepEqual(dryRun.missingReferences, ["entry:child"]);
    assert.equal(dryRun.checks.find((check) => check.code === "references")?.status, "failed");
    assert.equal(dryRun.dryRunReceipt, undefined);
  } finally {
    target.close();
  }
});

test("dry run compares the package with current target records without writing", () => {
  const source = database();
  const target = database();
  try {
    source.transaction(() => importData(createEdgeCaseDemoData(), "fixture-actor", source))();
    target.prepare(`
      INSERT INTO children (id, name, birth_month, birth_year, color, created_at, updated_at)
      VALUES ('target-child', 'Target child', 1, 2018, '#0f8b8d', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run();
    const before = target.serialize();
    const dryRun = dryRunPortableTransfer(createPortableTransfer(source), target);
    const children = dryRun.comparison.find((item) => item.category === "children");
    assert.deepEqual(children, { category: "children", current: 1, incoming: 3, afterImport: 3 });
    assert.equal(dryRun.summary.currentRecords > 0, true);
    assert.deepEqual(target.serialize(), before);
  } finally {
    source.close();
    target.close();
  }
});
