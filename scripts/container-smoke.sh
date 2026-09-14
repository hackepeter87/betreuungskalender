#!/usr/bin/env bash
set -euo pipefail

suffix="${GITHUB_RUN_ID:-local}-$$-$RANDOM"
image="betreuungskalender:smoke-${suffix}"
container="betreuungskalender-smoke-${suffix}"
metrics_container="betreuungskalender-metrics-smoke-${suffix}"
volume="betreuungskalender-smoke-data-${suffix}"
metrics_volume="betreuungskalender-metrics-smoke-data-${suffix}"
dockerfile="${DOCKERFILE:-Dockerfile}"
legal_dir="$(mktemp -d)"
metrics_dir="$(mktemp -d)"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
  docker rm --force "$metrics_container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker volume rm "$metrics_volume" >/dev/null 2>&1 || true
  docker image rm --force "$image" >/dev/null 2>&1 || true
  rm -rf "$legal_dir"
  rm -rf "$metrics_dir"
}
trap cleanup EXIT

cp docs/examples/legal/impressum.txt.example "$legal_dir/impressum.txt"
cp docs/examples/legal/datenschutz.txt.example "$legal_dir/datenschutz.txt"
chmod 0755 "$legal_dir"
chmod 0644 "$legal_dir/impressum.txt" "$legal_dir/datenschutz.txt"
printf '%s\n' 'container-smoke-metrics-token-0123456789abcdef' > "$metrics_dir/token"
chmod 0755 "$metrics_dir"
chmod 0644 "$metrics_dir/token"

wait_for_health() {
  local target_container="${1:-$container}"
  for attempt in $(seq 1 30); do
    if docker exec "$target_container" /nodejs/bin/node scripts/healthcheck.js; then
      return 0
    fi
    sleep 2
  done
  docker logs "$target_container"
  return 1
}

docker build --file "$dockerfile" --tag "$image" .
docker volume create "$volume" >/dev/null
docker run --detach --name "$container" \
  --volume "$volume:/data" \
  --volume "$legal_dir:/run/config/legal:ro" \
  --env AUTH_MODE=local \
  --env REQUIRE_AUTH=false \
  --env TRUST_PROXY_AUTH=false \
  --env ALLOWED_ORIGIN=http://localhost:3000 \
  "$image" >/dev/null

wait_for_health

docker exec "$container" /nodejs/bin/node --input-type=module -e '
  for (const path of ["/impressum", "/datenschutz"]) {
    const response = await fetch(`http://127.0.0.1:3000${path}`);
    if (!response.ok) throw new Error(`Legal page failed: ${path} ${response.status}`);
    if (!response.headers.get("cache-control")?.includes("no-store")) throw new Error(`Legal page can be cached: ${path}`);
    if (!(await response.text()).includes("BETREIBERVORLAGE - NICHT VERÖFFENTLICHUNGSFERTIG")) throw new Error(`Mounted legal content missing: ${path}`);
  }
  const { writeFile } = await import("node:fs/promises");
  try {
    await writeFile("/run/config/legal/impressum.txt", "changed");
    throw new Error("Legal content mount is writable");
  } catch (error) {
    if (!error || !["EROFS", "EACCES", "EPERM"].includes(error.code)) throw error;
  }
'

docker exec "$container" /nodejs/bin/node --input-type=module -e '
  const response = await fetch("http://127.0.0.1:3000/api/children", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Container Smoke Child", birthMonth: 1, birthYear: 2016, color: "#2563eb" })
  });
  if (!response.ok) throw new Error(`Child creation failed: ${response.status}`);
'

docker restart "$container" >/dev/null
wait_for_health

docker exec "$container" /nodejs/bin/node --input-type=module -e '
  const children = await (await fetch("http://127.0.0.1:3000/api/children")).json();
  if (!children.some((child) => child.name === "Container Smoke Child")) throw new Error("Persistent child missing after restart");
'

docker exec "$container" /nodejs/bin/node --input-type=module -e '
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

docker volume create "$metrics_volume" >/dev/null
docker run --detach --name "$metrics_container" \
  --volume "$metrics_volume:/data" \
  --volume "$legal_dir:/run/config/legal:ro" \
  --volume "$metrics_dir/token:/run/secrets/metrics/token:ro" \
  --env AUTH_MODE=local \
  --env REQUIRE_AUTH=false \
  --env TRUST_PROXY_AUTH=false \
  --env ALLOWED_ORIGIN=http://localhost:3000 \
  --env METRICS_ENABLED=true \
  --env METRICS_HOST=127.0.0.1 \
  --env METRICS_PORT=9090 \
  --env METRICS_BEARER_TOKEN_FILE=/run/secrets/metrics/token \
  "$image" >/dev/null

wait_for_health "$metrics_container"

docker exec "$metrics_container" /nodejs/bin/node --input-type=module -e '
  const unauthorized = await fetch("http://127.0.0.1:9090/metrics");
  if (unauthorized.status !== 401) throw new Error(`Expected metrics 401, received ${unauthorized.status}`);
  const response = await fetch("http://127.0.0.1:9090/metrics", {
    headers: { authorization: "Bearer container-smoke-metrics-token-0123456789abcdef" }
  });
  if (!response.ok) throw new Error(`Metrics request failed: ${response.status}`);
  if (!response.headers.get("cache-control")?.includes("no-store")) throw new Error("Metrics response can be cached");
  const body = await response.text();
  if (!body.includes("betreuungskalender_process_uptime_seconds")) throw new Error("Expected runtime metric missing");
  for (const forbidden of ["container-smoke-metrics-token", "request_id", "email"]) {
    if (body.includes(forbidden)) throw new Error(`Sensitive metrics content found: ${forbidden}`);
  }
  const applicationResponse = await fetch("http://127.0.0.1:3000/metrics");
  const applicationBody = await applicationResponse.text();
  if (applicationBody.includes("betreuungskalender_process_uptime_seconds")) {
    throw new Error("Application listener exposed Prometheus metrics");
  }
'

docker stop --time 10 "$metrics_container" >/dev/null
