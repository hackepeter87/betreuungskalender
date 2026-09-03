import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composeFiles = [
  "deploy/compose.yml",
  "deploy/compose.oidc.yml",
  "deploy/compose.testing.yml",
  "deploy/compose.production.yml"
];

test("default Compose definitions remain SQLite-only", async () => {
  for (const path of composeFiles) {
    const content = await readFile(path, "utf8");
    assert.doesNotMatch(content, /^\s{2}postgres:\s*$/m, `${path} must not start PostgreSQL`);
    assert.doesNotMatch(content, /DATABASE_DRIVER:\s*postgres/, `${path} must not select PostgreSQL`);
  }
});

test("the optional PostgreSQL Compose overlay keeps credentials and the database private", async () => {
  const content = await readFile("deploy/compose.postgres.yml", "utf8");

  assert.match(content, /image:\s*postgres:16-bookworm\b/);
  assert.match(content, /DATABASE_DRIVER:\s*postgres\b/);
  assert.match(content, /POSTGRES_PASSWORD_FILE:\s*\/run\/secrets\/postgres-password\b/g);
  assert.match(content, /condition:\s*service_healthy\b/);
  assert.match(content, /networks:\n\s+- app-runtime\n\s+- postgres-private/);
  assert.match(content, /internal:\s*true\b/);
  assert.match(content, /file:\s*\$\{POSTGRES_PASSWORD_FILE:\?[^}]+\}/);
  assert.match(content, /file:\s*\$\{POSTGRES_ADMIN_PASSWORD_FILE:\?[^}]+\}/);
  assert.match(content, /pg_isready/);

  const serviceStart = content.indexOf("\n  postgres:\n");
  const serviceEnd = content.indexOf("\nsecrets:\n", serviceStart);
  const postgresService = serviceStart >= 0 && serviceEnd > serviceStart
    ? content.slice(serviceStart, serviceEnd)
    : "";
  assert.ok(postgresService, "PostgreSQL service is missing");
  assert.doesNotMatch(postgresService, /^\s+ports:\s*$/m, "PostgreSQL must not publish a host port");
  assert.doesNotMatch(content, /postgres(?:ql)?:\/\//i, "Compose must not contain a connection URL");
  assert.doesNotMatch(content, /POSTGRES_PASSWORD:\s*(?!_FILE)/, "Compose must not contain a plaintext password variable");
});

test("the embedded database creates a restricted application role", async () => {
  const content = await readFile("deploy/postgres/init/001-create-application-role.sh", "utf8");

  assert.match(content, /--no-superuser/);
  assert.match(content, /--no-createdb/);
  assert.match(content, /--no-createrole/);
  assert.match(content, /--no-replication/);
  assert.match(content, /--no-bypassrls/);
  assert.match(content, /REVOKE ALL ON DATABASE/);
  assert.doesNotMatch(content, /--password(?:=|\s)/, "The password must not be passed as a process argument");
});

test("the Compose guide keeps file secrets reachable only through a private directory", async () => {
  const content = await readFile("docs/deployment-container.md", "utf8");

  assert.match(content, /install -d -m 0700 secrets/);
  assert.match(content, /chmod 0644 secrets\/postgres-\*-password/);
  assert.match(content, /nonroot users in the application and PostgreSQL containers/);
  assert.match(content, /Do not place them in a shared or traversable directory/);
});
