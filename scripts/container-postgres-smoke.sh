#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="${GITHUB_RUN_ID:-local}-$$-$RANDOM"
source_project="bk-sqlite-${suffix}"
target_project="bk-postgres-${suffix}"
work_dir="$(mktemp -d)"
source_dir="$work_dir/source"
target_dir="$work_dir/target"
transfer_file="$work_dir/portable-transfer.json"
secret_marker_file="$work_dir/secret-markers"
image_tag="compose-smoke-${suffix}"

cleanup() {
  docker compose --project-name "$source_project" --project-directory "$source_dir" \
    --env-file "$source_dir/.env" -f "$source_dir/compose.yml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker compose --project-name "$target_project" --project-directory "$target_dir" \
    --env-file "$target_dir/.env" -f "$target_dir/compose.yml" -f "$target_dir/compose.postgres.yml" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker image rm --force "betreuungskalender:${image_tag}" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT

if [[ ! -d "$repo_root/dist" || ! -d "$repo_root/dist-server" ]]; then
  echo "Build output is missing. Run npm run build before the PostgreSQL Compose smoke test." >&2
  exit 1
fi

find_port() {
  node -e '
    const net = require("node:net");
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(String(server.address().port));
      server.close();
    });
  '
}

source_port="$(find_port)"
target_port="$(find_port)"

mkdir -p \
  "$source_dir/data" \
  "$source_dir/backups" \
  "$target_dir/data" \
  "$target_dir/backups" \
  "$target_dir/secrets" \
  "$target_dir/postgres/init"
chmod 0700 "$work_dir" "$source_dir" "$target_dir" "$target_dir/secrets"
chmod 0755 "$target_dir/postgres" "$target_dir/postgres/init"
chmod 0777 "$source_dir/data" "$source_dir/backups" "$target_dir/data" "$target_dir/backups"
cp "$repo_root/deploy/compose.yml" "$source_dir/compose.yml"
cp "$repo_root/deploy/compose.yml" "$target_dir/compose.yml"
cp "$repo_root/deploy/compose.oidc.yml" "$target_dir/compose.oidc.yml"
cp "$repo_root/deploy/compose.postgres.yml" "$target_dir/compose.postgres.yml"
cp "$repo_root/deploy/postgres/init/001-create-application-role.sh" "$target_dir/postgres/init/001-create-application-role.sh"

cat >"$source_dir/.env" <<EOF
APP_RELEASE_VERSION=$image_tag
APP_RELEASE_DIR=$repo_root
HOST_BIND_ADDRESS=127.0.0.1
HOST_PORT=$source_port
AUTH_MODE=local
REQUIRE_AUTH=false
TRUST_PROXY_AUTH=false
ALLOWED_ORIGIN=http://127.0.0.1:$source_port
DATABASE_DRIVER=sqlite
LOG_LEVEL=info
EOF
chmod 0600 "$source_dir/.env"

{
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'
  printf '\n'
} >"$target_dir/secrets/postgres-admin-password"
{
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'
  printf '\n'
} >"$target_dir/secrets/postgres-password"
chmod 0600 "$target_dir/secrets/postgres-admin-password" "$target_dir/secrets/postgres-password"
cp "$target_dir/secrets/postgres-password" "$work_dir/original-postgres-password"
printf '%s\n%s\n' \
  "$(<"$target_dir/secrets/postgres-admin-password")" \
  "$(<"$target_dir/secrets/postgres-password")" >"$secret_marker_file"
chmod 0600 "$work_dir/original-postgres-password" "$secret_marker_file"

cat >"$target_dir/.env" <<EOF
APP_RELEASE_VERSION=$image_tag
APP_RELEASE_DIR=$repo_root
HOST_BIND_ADDRESS=127.0.0.1
HOST_PORT=$target_port
AUTH_MODE=local
REQUIRE_AUTH=false
TRUST_PROXY_AUTH=false
ALLOWED_ORIGIN=http://127.0.0.1:$target_port
DATABASE_DRIVER=postgres
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DATABASE=betreuungskalender
POSTGRES_USER=betreuungskalender
POSTGRES_PASSWORD_FILE=$target_dir/secrets/postgres-password
POSTGRES_ADMIN_PASSWORD_FILE=$target_dir/secrets/postgres-admin-password
POSTGRES_TLS_MODE=disable
LOG_LEVEL=info
EOF
chmod 0600 "$target_dir/.env"

source_compose() {
  docker compose --project-name "$source_project" --project-directory "$source_dir" \
    --env-file "$source_dir/.env" -f "$source_dir/compose.yml" "$@"
}

target_compose() {
  docker compose --project-name "$target_project" --project-directory "$target_dir" \
    --env-file "$target_dir/.env" -f "$target_dir/compose.yml" -f "$target_dir/compose.postgres.yml" "$@"
}

wait_for_health() {
  local url="$1"
  local log_target="$2"
  for _attempt in $(seq 1 60); do
    if curl --fail --silent --show-error "$url/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  "$log_target" logs --no-color
  return 1
}

assert_secret_absent() {
  local path="$1"
  while IFS= read -r secret; do
    if [[ -n "$secret" ]] && grep -Fq "$secret" "$path"; then
      echo "A database secret appeared in $path." >&2
      exit 1
    fi
  done <"$secret_marker_file"
  if grep -Eiq 'postgres(ql)?://' "$path"; then
    echo "A PostgreSQL connection URL appeared in $path." >&2
    exit 1
  fi
}

source_compose up --detach --build
wait_for_health "http://127.0.0.1:$source_port" source_compose

SOURCE_URL="http://127.0.0.1:$source_port" TRANSFER_FILE="$transfer_file" node --input-type=module <<'NODE'
import { writeFile } from "node:fs/promises";

const childResponse = await fetch(`${process.env.SOURCE_URL}/api/children`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "Compose transfer fixture",
    birthMonth: 4,
    birthYear: 2017,
    color: "#2563eb"
  })
});
if (!childResponse.ok) throw new Error(`SQLite fixture creation failed: ${childResponse.status}`);

const exportResponse = await fetch(`${process.env.SOURCE_URL}/api/data-transfer/export`);
if (!exportResponse.ok) throw new Error(`SQLite transfer export failed: ${exportResponse.status}`);
await writeFile(process.env.TRANSFER_FILE, await exportResponse.text(), { mode: 0o600 });
NODE

source_compose down --volumes --remove-orphans

target_compose config >"$work_dir/rendered-compose.yml"
target_compose config --format json >"$work_dir/rendered-compose.json"
docker compose --project-name "${target_project}-oidc-config" --project-directory "$target_dir" \
  --env-file "$target_dir/.env" -f "$target_dir/compose.oidc.yml" -f "$target_dir/compose.postgres.yml" \
  config --format json >"$work_dir/rendered-oidc-compose.json"
assert_secret_absent "$work_dir/rendered-compose.yml"

RENDERED_COMPOSE="$work_dir/rendered-compose.json" \
  RENDERED_OIDC_COMPOSE="$work_dir/rendered-oidc-compose.json" \
  node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(process.env.RENDERED_COMPOSE, "utf8"));
assert.equal(config.services.postgres.ports, undefined, "PostgreSQL publishes a host port");
assert.equal(config.networks["postgres-private"].internal, true, "PostgreSQL network is not internal");
assert.deepEqual(Object.keys(config.services.postgres.networks), ["postgres-private"]);
assert.equal("app-runtime" in config.services.betreuungskalender.networks, true);
assert.equal(config.services.betreuungskalender.environment.DATABASE_DRIVER, "postgres");
assert.equal(config.services.betreuungskalender.environment.POSTGRES_PASSWORD_FILE, "/run/secrets/postgres-password");

const oidcConfig = JSON.parse(await readFile(process.env.RENDERED_OIDC_COMPOSE, "utf8"));
assert.equal(oidcConfig.services.betreuungskalender.ports, undefined, "OIDC app publishes a host port");
assert.deepEqual(
  Object.keys(oidcConfig.services.betreuungskalender.networks).sort(),
  ["app-runtime", "oidc-private", "postgres-private"]
);
assert.deepEqual(Object.keys(oidcConfig.services["oauth2-proxy"].networks), ["oidc-private"]);
assert.deepEqual(Object.keys(oidcConfig.services.postgres.networks), ["postgres-private"]);
NODE

target_compose up --detach --no-build
wait_for_health "http://127.0.0.1:$target_port" target_compose

TARGET_URL="http://127.0.0.1:$target_port" TRANSFER_FILE="$transfer_file" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageData = JSON.parse(await readFile(process.env.TRANSFER_FILE, "utf8"));
const request = async (path, init) => {
  const response = await fetch(`${process.env.TARGET_URL}${path}`, init);
  return { response, body: await response.json() };
};

const before = await request("/api/children");
assert.equal(before.response.status, 200);
assert.equal(before.body.length, 0, "PostgreSQL target is not empty before the dry run");

const dryRun = await request("/api/data-transfer/dry-run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(packageData)
});
assert.equal(dryRun.response.status, 200, JSON.stringify(dryRun.body));
assert.ok(["ready", "warnings"].includes(dryRun.body.result));
assert.equal(typeof dryRun.body.dryRunReceipt, "string");

const afterDryRun = await request("/api/children");
assert.equal(afterDryRun.body.length, 0, "Dry run changed PostgreSQL domain data");

const changedPackage = structuredClone(packageData);
changedPackage.data.children[0].name = "Changed after dry run";
const rejected = await request("/api/data-transfer/import", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    package: changedPackage,
    fingerprint: dryRun.body.fingerprint,
    dryRunReceipt: dryRun.body.dryRunReceipt,
    confirmWarnings: true
  })
});
assert.equal(rejected.response.status, 400, "Changed package was accepted");
assert.equal((await request("/api/children")).body.length, 0, "Rejected import partially changed data");

const imported = await request("/api/data-transfer/import", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    package: packageData,
    fingerprint: dryRun.body.fingerprint,
    dryRunReceipt: dryRun.body.dryRunReceipt,
    confirmWarnings: dryRun.body.result === "warnings"
  })
});
assert.equal(imported.response.status, 200, JSON.stringify(imported.body));

const children = (await request("/api/children")).body;
assert.equal(children.some((child) => child.name === "Compose transfer fixture"), true);
NODE

target_compose restart postgres
target_compose restart betreuungskalender
wait_for_health "http://127.0.0.1:$target_port" target_compose

TARGET_URL="http://127.0.0.1:$target_port" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.TARGET_URL}/api/children`);
const children = await response.json();
if (!children.some((child) => child.name === "Compose transfer fixture")) {
  throw new Error("PostgreSQL data did not survive a database and application restart");
}
NODE

target_compose stop postgres
for _attempt in $(seq 1 20); do
  if ! curl --fail --silent "http://127.0.0.1:$target_port/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if curl --fail --silent "http://127.0.0.1:$target_port/api/health" >/dev/null 2>&1; then
  echo "Health endpoint stayed successful while PostgreSQL was unavailable." >&2
  exit 1
fi
target_compose start postgres
target_compose restart betreuungskalender
wait_for_health "http://127.0.0.1:$target_port" target_compose

{
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))'
  printf '\n'
} >"$target_dir/secrets/postgres-password"
printf '%s\n' "$(<"$target_dir/secrets/postgres-password")" >>"$secret_marker_file"
target_compose up --detach --no-deps --force-recreate betreuungskalender
sleep 5
if curl --fail --silent "http://127.0.0.1:$target_port/api/health" >/dev/null 2>&1; then
  echo "The application stayed healthy with an invalid PostgreSQL secret." >&2
  exit 1
fi
target_compose logs --no-color betreuungskalender >"$work_dir/invalid-secret.log" 2>&1
assert_secret_absent "$work_dir/invalid-secret.log"

cp "$work_dir/original-postgres-password" "$target_dir/secrets/postgres-password"
target_compose up --detach --no-deps --force-recreate betreuungskalender
wait_for_health "http://127.0.0.1:$target_port" target_compose

target_compose logs --no-color >"$work_dir/compose.log" 2>&1
assert_secret_absent "$work_dir/compose.log"
