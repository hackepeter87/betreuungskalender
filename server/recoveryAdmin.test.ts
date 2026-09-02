import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { migrateDatabase } from "./db/migrationRunner.js";
import { recoveryAdminRoutes } from "./routes/recoveryAdmin.js";
import {
  RecoveryAdminError,
  RecoveryAdminStore,
  recoveryAdminTesting
} from "./services/recoveryAdmin.js";

function testDatabase() {
  const root = mkdtempSync(join(tmpdir(), "betreuungskalender-recovery-"));
  const database = new Database(join(root, "app.sqlite"));
  database.pragma("foreign_keys = ON");
  migrateDatabase(database);
  return {
    root,
    database,
    cleanup() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

function recoveryConfig(overrides: Partial<ConstructorParameters<typeof RecoveryAdminStore>[0]> = {}) {
  return {
    enabled: true,
    username: "breakglass",
    initialPassword: "Initial recovery passphrase",
    sessionTtlSeconds: 900,
    ...overrides
  };
}

function routeConfig(overrides: Partial<Parameters<typeof recoveryAdminRoutes>[1]["config"]> = {}) {
  return {
    nodeEnv: "production",
    recoveryAdminEnabled: true,
    recoveryAdminUsername: "breakglass",
    recoveryAdminInitialPasswordFile: "/does/not/exist",
    recoveryAdminInitialPassword: "Initial recovery passphrase",
    recoveryAdminSessionCookieName: "betreuungskalender_recovery",
    recoveryAdminSessionTtlSeconds: 900,
    rateLimitSensitiveMax: 5,
    rateLimitWindowMs: 60_000,
    ...overrides
  };
}

function cookieValue(setCookie: string | undefined): string {
  assert.ok(setCookie);
  const first = setCookie.split(";")[0];
  assert.ok(first);
  return first;
}

test("recovery admin requires an initial secret when enabled without stored credential", () => {
  const { database, cleanup } = testDatabase();
  try {
    const store = new RecoveryAdminStore(
      recoveryConfig({
        initialPassword: undefined,
        initialPasswordFile: "/does/not/exist"
      }),
      database
    );
    assert.throws(
      () => store.ensureConfigured(),
      /RECOVERY_ADMIN_ENABLED=true requires an existing recovery credential/
    );
  } finally {
    cleanup();
  }
});

test("recovery admin reads the initial password from a mounted secret file first", () => {
  const { root, database, cleanup } = testDatabase();
  try {
    const secretFile = join(root, "recovery-password");
    writeFileSync(secretFile, "Secret file passphrase\n", { mode: 0o600 });
    const store = new RecoveryAdminStore(
      recoveryConfig({
        initialPasswordFile: secretFile,
        initialPassword: "Wrong fallback"
      }),
      database
    );

    const login = store.login("breakglass", "Secret file passphrase");
    assert.equal(login.session.passwordChangeRequired, true);
  } finally {
    cleanup();
  }
});

test("first recovery login forces password change before admin access", () => {
  const { database, cleanup } = testDatabase();
  try {
    const store = new RecoveryAdminStore(recoveryConfig(), database);
    store.ensureConfigured();

    const login = store.login(
      "breakglass",
      "Initial recovery passphrase",
      new Date("2026-07-01T00:00:00.000Z")
    );
    assert.equal(login.session.passwordChangeRequired, true);
    assert.equal(store.findUserByToken(login.token), undefined);

    const changed = store.changePassword(
      login.token,
      "Changed recovery passphrase",
      new Date("2026-07-01T00:01:00.000Z")
    );
    assert.equal(changed.session.passwordChangeRequired, false);
    assert.equal(changed.user.externalSubject, "recovery:breakglass");
    assert.equal(changed.user.role, "admin");
    assert.equal(
      store.findUserByToken(login.token, new Date("2026-07-01T00:02:00.000Z"))?.role,
      "admin"
    );

    assert.throws(
      () => store.login("breakglass", "Initial recovery passphrase"),
      (error) =>
        error instanceof RecoveryAdminError &&
        error.code === "recovery_login_failed" &&
        error.statusCode === 401
    );

    const nextLogin = store.login("breakglass", "Changed recovery passphrase");
    assert.equal(nextLogin.session.passwordChangeRequired, false);
    assert.equal(nextLogin.user?.role, "admin");
    assert.equal(store.revokeByToken(nextLogin.token), true);

    const credential = database.prepare(`
      SELECT password_hash, password_salt
      FROM recovery_admin_credentials
      WHERE username = 'breakglass'
    `).get() as { password_hash: string; password_salt: string };
    assert.notEqual(credential.password_hash, "Changed recovery passphrase");
    assert.equal(
      credential.password_hash,
      recoveryAdminTesting.hashPassword("Changed recovery passphrase", credential.password_salt).hash
    );

    const auditEvents = database.prepare(`
      SELECT field_name
      FROM audit_log
      WHERE entity_type = 'recovery_admin'
      ORDER BY id
    `).all() as Array<{ field_name: string }>;
    assert.deepEqual(auditEvents.map((event) => event.field_name), [
      "bootstrap_login_succeeded",
      "password_changed",
      "login_failed",
      "login_succeeded",
      "logout"
    ]);
  } finally {
    cleanup();
  }
});

test("recovery routes are disabled by default", async () => {
  const { database, cleanup } = testDatabase();
  const app = Fastify({ logger: false });
  try {
    await app.register(recoveryAdminRoutes, {
      config: routeConfig({
        recoveryAdminEnabled: false,
        recoveryAdminInitialPassword: undefined
      }),
      store: new RecoveryAdminStore(recoveryConfig({ enabled: false }), database)
    });

    const response = await app.inject({ method: "GET", url: "/auth/recovery" });
    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
    cleanup();
  }
});

test("recovery routes create short lived server-side sessions and require password change", async () => {
  const { database, cleanup } = testDatabase();
  const app = Fastify({ logger: false });
  try {
    await app.register(recoveryAdminRoutes, {
      config: routeConfig(),
      store: new RecoveryAdminStore(recoveryConfig(), database)
    });

    const loginPage = await app.inject({ method: "GET", url: "/auth/recovery" });
    assert.equal(loginPage.statusCode, 200);
    assert.match(loginPage.payload, /href="\/impressum"/);
    assert.match(loginPage.payload, /href="\/datenschutz"/);

    const login = await app.inject({
      method: "POST",
      url: "/auth/recovery/login",
      payload: {
        username: "breakglass",
        password: "Initial recovery passphrase"
      }
    });
    assert.equal(login.statusCode, 200);
    assert.deepEqual(JSON.parse(login.body), {
      authenticated: false,
      passwordChangeRequired: true,
      changePasswordUrl: "/auth/recovery/change-password"
    });
    assert.match(login.headers["set-cookie"] as string, /HttpOnly/);
    assert.match(login.headers["set-cookie"] as string, /Secure/);
    const cookie = cookieValue(login.headers["set-cookie"] as string);

    const change = await app.inject({
      method: "POST",
      url: "/auth/recovery/change-password",
      headers: { cookie },
      payload: { newPassword: "Changed recovery passphrase" }
    });
    assert.equal(change.statusCode, 200);
    assert.deepEqual(JSON.parse(change.body), {
      authenticated: true,
      passwordChangeRequired: false,
      user: {
        id: recoveryAdminTesting.userForUsername("breakglass").id,
        displayName: "breakglass",
        role: "admin"
      }
    });

    const bootstrapAgain = await app.inject({
      method: "POST",
      url: "/auth/recovery/login",
      payload: {
        username: "breakglass",
        password: "Initial recovery passphrase"
      }
    });
    assert.equal(bootstrapAgain.statusCode, 401);
    assert.deepEqual(JSON.parse(bootstrapAgain.body), {
      error: "recovery_login_failed",
      message: "Anmeldung fehlgeschlagen."
    });
  } finally {
    await app.close();
    cleanup();
  }
});
