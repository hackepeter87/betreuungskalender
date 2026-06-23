#!/usr/bin/env bash
set -euo pipefail

suffix="${GITHUB_RUN_ID:-local}-$$-$RANDOM"
image="betreuungskalender:smoke-${suffix}"
container="betreuungskalender-smoke-${suffix}"
volume="betreuungskalender-smoke-data-${suffix}"
dockerfile="${DOCKERFILE:-Dockerfile}"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm --force "$image" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_health() {
  for attempt in $(seq 1 30); do
    if docker exec "$container" node scripts/healthcheck.js; then
      return 0
    fi
    sleep 2
  done
  docker logs "$container"
  return 1
}

docker build --file "$dockerfile" --tag "$image" .
docker volume create "$volume" >/dev/null
docker run --detach --name "$container" \
  --volume "$volume:/data" \
  --env REQUIRE_AUTH=false \
  --env TRUST_PROXY_AUTH=false \
  --env ALLOWED_ORIGIN=http://localhost:3000 \
  "$image" >/dev/null

wait_for_health

docker exec "$container" node --input-type=module -e '
  const response = await fetch("http://127.0.0.1:3000/api/children", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Container Smoke Child", birthMonth: 1, birthYear: 2016, color: "#2563eb" })
  });
  if (!response.ok) throw new Error(`Child creation failed: ${response.status}`);
'

docker restart "$container" >/dev/null
wait_for_health

docker exec "$container" node --input-type=module -e '
  const children = await (await fetch("http://127.0.0.1:3000/api/children")).json();
  if (!children.some((child) => child.name === "Container Smoke Child")) throw new Error("Persistent child missing after restart");
'

docker exec "$container" node --input-type=module -e '
  import Database from "better-sqlite3";
  const db = new Database("/data/app.sqlite", { readonly: true });
  const migrations = db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get();
  const duplicates = db.prepare("SELECT version FROM schema_migrations GROUP BY version HAVING COUNT(*) > 1").all();
  if (migrations.count < 5 || duplicates.length) throw new Error("Migration state is not idempotent");
'

if docker logs "$container" 2>&1 | grep -Ei 'sqlite.*(error|constraint)|migration.*(error|failed)|uncaught exception'; then
  echo "Container logs contain a startup or migration error." >&2
  exit 1
fi

docker stop --time 10 "$container" >/dev/null
