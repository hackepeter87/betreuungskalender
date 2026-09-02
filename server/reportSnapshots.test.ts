import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { importData } from "./routes/appData.js";
import { reportRoutes } from "./routes/reports.js";
import { createEdgeCaseDemoData } from "./services/demoFixtures.js";
import { createReportSnapshot } from "./services/reportSnapshots.js";

async function database() {
  const result = createSqlitePersistenceRuntime(":memory:");
  await result.migrate();
  return result;
}

test("report snapshots use one read transaction and leave the database unchanged", async () => {
  const runtime = await database();
  const db = runtime.sqliteDatabase;
  try {
    await runtime.transaction((database) => importData(createEdgeCaseDemoData(), "fixture-actor", database));
    db.prepare(`
      INSERT INTO audit_log (
        timestamp, user_email, entity_type, entity_id, action,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "2026-07-15T12:00:00.000Z",
      "fixture-actor",
      "care_entry",
      "demo-entry-short-contact",
      "updated",
      "2026-07-15T12:00:00.000Z",
      "2026-07-15T12:00:00.000Z"
    );
    const before = db.serialize();

    const snapshot = await createReportSnapshot({
      persistence: runtime,
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      includeAuditHistory: true
    });

    assert.match(snapshot.reportId, /^BK-\d{8}-[A-F0-9]{8}$/);
    assert.equal(snapshot.startDate, "2026-07-01");
    assert.equal(snapshot.endDate, "2026-07-31");
    assert.equal(snapshot.data.entries.some((entry) => entry.id === "demo-entry-month-boundary-overnight"), true);
    assert.equal(snapshot.data.holidayPeriods.length, 2);
    assert.equal(snapshot.data.unavailablePeriods.length, 2);
    assert.equal(snapshot.data.monthClosures.length, 0);
    assert.equal(snapshot.data.auditLog.length >= 1, true);
    assert.equal(
      snapshot.data.auditLog.find((entry) => entry.entityId === "demo-entry-short-contact")?.effectiveDate,
      "2026-07-15"
    );
    assert.deepEqual(db.serialize(), before);
  } finally {
    await runtime.close();
  }
});

test("report snapshots omit history and use half-open entry end times", async () => {
  const runtime = await database();
  try {
    await runtime.transaction((database) => importData(createEdgeCaseDemoData(), "fixture-actor", database));
    const snapshot = await createReportSnapshot({
      persistence: runtime,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      includeAuditHistory: false
    });

    assert.equal(snapshot.data.entries.length, 0);
    assert.equal(snapshot.data.holidayPeriods.length, 1);
    assert.deepEqual(snapshot.data.auditLog, []);
  } finally {
    await runtime.close();
  }
});

test("report snapshot responses are not cached", async () => {
  const runtime = await database();
  const app = Fastify();
  app.decorate("persistence", runtime);
  await reportRoutes(app);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/reports/snapshot?startDate=2026-08-01&endDate=2026-08-31"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
  } finally {
    await app.close();
    await runtime.close();
  }
});
