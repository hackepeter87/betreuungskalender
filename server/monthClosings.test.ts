import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSqlitePersistenceRuntime } from "./db/runtime.js";
import { monthClosingRoutes } from "./routes/monthClosings.js";
import { markDomainClosedMonthsChanged } from "./services/domainPersistence.js";

async function fixture() {
  const persistence = createSqlitePersistenceRuntime(":memory:");
  await persistence.migrate();
  const app = Fastify();
  app.decorate("persistence", persistence);
  app.addHook("onRequest", async (request) => {
    request.userEmail = "closing-test";
  });
  await monthClosingRoutes(app);
  return { app, persistence };
}

const closingInput = {
  monthKey: "2026-08",
  dataUpdatedAt: "2026-09-01T08:00:00.000Z",
  summary: { entries: 4 }
};

test("monthly closings create, read, and record later changes through the runtime", async () => {
  const { app, persistence } = await fixture();
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/month-closings",
      payload: closingInput
    });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json(), {
      monthKey: "2026-08",
      closedAt: created.json().closedAt,
      closedBy: "closing-test",
      dataUpdatedAt: closingInput.dataUpdatedAt,
      summary: closingInput.summary,
      updatedBy: "closing-test"
    });

    const repeated = await app.inject({
      method: "POST",
      url: "/api/month-closings",
      payload: { ...closingInput, summary: { entries: 99 } }
    });
    assert.equal(repeated.statusCode, 200);
    assert.deepEqual(repeated.json().summary, closingInput.summary);

    const changedAt = "2026-09-02T10:00:00.000Z";
    await persistence.transaction((database) => markDomainClosedMonthsChanged(
      database,
      "closing-editor",
      "care_entry",
      "entry-1",
      "2026-08-31",
      "2026-08-31",
      changedAt
    ));

    const listed = await app.inject({ method: "GET", url: "/api/month-closings" });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json(), [{
      ...created.json(),
      changedAfterCloseAt: changedAt,
      updatedBy: "closing-editor"
    }]);
  } finally {
    await app.close();
    await persistence.close();
  }
});

test("monthly closing creation rolls back when the audit write fails", async () => {
  const { app, persistence } = await fixture();
  try {
    persistence.sqliteDatabase.exec(`
      CREATE TRIGGER reject_month_closing_audit
      BEFORE INSERT ON audit_log
      WHEN NEW.entity_type = 'month_closure'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic audit failure');
      END;
    `);
    const response = await app.inject({
      method: "POST",
      url: "/api/month-closings",
      payload: closingInput
    });
    assert.equal(response.statusCode, 500);
    const row = await persistence.query.selectFrom("monthly_closings")
      .select("id")
      .where("month_key", "=", closingInput.monthKey)
      .executeTakeFirst();
    assert.equal(row, undefined);
  } finally {
    await app.close();
    await persistence.close();
  }
});
