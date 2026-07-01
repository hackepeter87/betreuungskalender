import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrateDatabase } from "../db/migrationRunner.js";
import {
  OidcSessionStore,
  oidcSessionTokenForTesting
} from "./oidcSessions.js";

function testDatabase() {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-oidc-session-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  migrateDatabase(database);
  return {
    database,
    cleanup() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test("OIDC sessions store only a hash of the opaque browser token", () => {
  const { database, cleanup } = testDatabase();
  try {
    const store = new OidcSessionStore(database);
    const { token, session } = store.create(
      "subject-123",
      3600,
      new Date("2026-01-01T00:00:00.000Z")
    );

    assert.equal(token.length > 40, true);
    assert.equal(session.externalSubject, "subject-123");

    const row = database.prepare(`
      SELECT session_hash, external_subject, expires_at
      FROM native_oidc_sessions
      WHERE id = ?
    `).get(session.id) as {
      session_hash: string;
      external_subject: string;
      expires_at: string;
    };
    assert.equal(row.external_subject, "subject-123");
    assert.equal(row.session_hash, oidcSessionTokenForTesting.hashSessionToken(token));
    assert.notEqual(row.session_hash, token);
    assert.equal(row.expires_at, "2026-01-01T01:00:00.000Z");
  } finally {
    cleanup();
  }
});

test("OIDC sessions expire and revoke server-side access", () => {
  const { database, cleanup } = testDatabase();
  try {
    const store = new OidcSessionStore(database);
    const { token } = store.create(
      "subject-123",
      60,
      new Date("2026-01-01T00:00:00.000Z")
    );

    assert.equal(
      store.findByToken(token, new Date("2026-01-01T00:00:30.000Z"))?.externalSubject,
      "subject-123"
    );
    assert.equal(
      store.findByToken(token, new Date("2026-01-01T00:01:00.000Z")),
      undefined
    );

    const { token: revokedToken } = store.create(
      "subject-456",
      60,
      new Date("2026-01-01T00:02:00.000Z")
    );
    assert.equal(store.revokeByToken(revokedToken, new Date("2026-01-01T00:02:10.000Z")), true);
    assert.equal(
      store.findByToken(revokedToken, new Date("2026-01-01T00:02:20.000Z")),
      undefined
    );
  } finally {
    cleanup();
  }
});
