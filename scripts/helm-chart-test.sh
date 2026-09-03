#!/usr/bin/env bash
set -euo pipefail

chart="charts/betreuungskalender"
example="${chart}/examples/native-oidc-values.yaml"
legal_example="${chart}/examples/legal-content-values.yaml"
postgres_external_example="${chart}/examples/postgresql-external-values.yaml"
postgres_evaluation_example="${chart}/examples/postgresql-evaluation-values.yaml"
workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

helm lint --strict "${chart}"
helm lint --strict "${chart}" --values "${example}"
helm lint --strict "${chart}" --values "${legal_example}"
helm lint --strict "${chart}" --values "${postgres_external_example}"
helm lint --strict "${chart}" --values "${postgres_evaluation_example}"

helm template family-one "${chart}" --namespace family-one \
  > "${workdir}/family-one.yaml"
helm template family-two "${chart}" --namespace family-two \
  --values "${example}" > "${workdir}/family-two.yaml"
helm template legal-content "${chart}" --namespace example \
  --values "${legal_example}" > "${workdir}/legal-content.yaml"
helm template external-postgres "${chart}" --namespace example \
  --values "${postgres_external_example}" > "${workdir}/external-postgres.yaml"
helm template evaluation-postgres "${chart}" --namespace example \
  --values "${postgres_evaluation_example}" > "${workdir}/evaluation-postgres.yaml"
helm template external-postgres-private "${chart}" --namespace example \
  --values "${postgres_external_example}" \
  --set-string database.postgres.tls.mode=disable \
  --set-string database.postgres.tls.caSecret.name= \
  > "${workdir}/external-postgres-private.yaml"

grep -q 'name: family-one-betreuungskalender-data' "${workdir}/family-one.yaml"
grep -A1 'name: DATABASE_DRIVER' "${workdir}/family-one.yaml" | grep -q 'value: "sqlite"'
grep -q 'name: DATABASE_PATH' "${workdir}/family-one.yaml"
if grep -q 'kind: StatefulSet' "${workdir}/family-one.yaml"; then
  echo "default SQLite values must not render PostgreSQL resources" >&2
  exit 1
fi
grep -q 'name: family-two-betreuungskalender-data' "${workdir}/family-two.yaml"
grep -q 'readOnlyRootFilesystem: true' "${workdir}/family-one.yaml"
grep -q 'runAsNonRoot: true' "${workdir}/family-one.yaml"
grep -q 'strategy:' "${workdir}/family-one.yaml"
grep -q 'type: Recreate' "${workdir}/family-one.yaml"
grep -Eq 'LEGAL_CONTENT_DIR: "?/run/config/legal"?' "${workdir}/legal-content.yaml"
grep -q 'mountPath: /run/config/legal' "${workdir}/legal-content.yaml"
grep -q 'readOnly: true' "${workdir}/legal-content.yaml"
grep -q 'name: betreuungskalender-operator-legal' "${workdir}/legal-content.yaml"

grep -A1 'name: DATABASE_DRIVER' "${workdir}/external-postgres.yaml" | grep -q 'value: "postgres"'
grep -A1 'name: POSTGRES_HOST' "${workdir}/external-postgres.yaml" | grep -q 'value: "postgres.example.invalid"'
grep -A1 'name: POSTGRES_TLS_MODE' "${workdir}/external-postgres.yaml" | grep -q 'value: "verify-full"'
grep -q 'secretName: betreuungskalender-postgres' "${workdir}/external-postgres.yaml"
grep -q 'secretName: betreuungskalender-postgres-ca' "${workdir}/external-postgres.yaml"
if grep -q 'name: external-postgres-betreuungskalender-data' "${workdir}/external-postgres.yaml"; then
  echo "external PostgreSQL must not render or mount the SQLite data claim" >&2
  exit 1
fi
if grep -q 'name: DATABASE_PATH' "${workdir}/external-postgres.yaml"; then
  echo "external PostgreSQL must not configure the SQLite database path" >&2
  exit 1
fi
if grep -q 'kind: StatefulSet' "${workdir}/external-postgres.yaml"; then
  echo "external PostgreSQL must not render an embedded database" >&2
  exit 1
fi
if grep -q 'kind: Secret' "${workdir}/external-postgres.yaml"; then
  echo "external PostgreSQL must reference, not render, credentials" >&2
  exit 1
fi
grep -A1 'name: POSTGRES_TLS_MODE' "${workdir}/external-postgres-private.yaml" | grep -q 'value: "disable"'
if grep -q 'name: POSTGRES_CA_FILE' "${workdir}/external-postgres-private.yaml"; then
  echo "disabled PostgreSQL TLS must not mount or configure a CA" >&2
  exit 1
fi

grep -q 'kind: StatefulSet' "${workdir}/evaluation-postgres.yaml"
grep -q 'name: evaluation-postgres-betreuungskalender-postgres-evaluation' "${workdir}/evaluation-postgres.yaml"
grep -q 'app.kubernetes.io/name: betreuungskalender-postgres-evaluation' "${workdir}/evaluation-postgres.yaml"
grep -q 'betreuungskalender.app/evaluation-only: "true"' "${workdir}/evaluation-postgres.yaml"
grep -q 'image: "postgres:16-bookworm"' "${workdir}/evaluation-postgres.yaml"
grep -q 'helm.sh/resource-policy: keep' "${workdir}/evaluation-postgres.yaml"
grep -q 'type: ClusterIP' "${workdir}/evaluation-postgres.yaml"
grep -q 'readOnlyRootFilesystem: true' "${workdir}/evaluation-postgres.yaml"
grep -A1 'name: POSTGRES_TLS_MODE' "${workdir}/evaluation-postgres.yaml" | grep -q 'value: "disable"'
if grep -q 'name: evaluation-postgres-betreuungskalender-data' "${workdir}/evaluation-postgres.yaml"; then
  echo "evaluation PostgreSQL must not render the application SQLite data claim" >&2
  exit 1
fi
if grep -q 'kind: Secret' "${workdir}/evaluation-postgres.yaml"; then
  echo "evaluation PostgreSQL must reference, not render, credentials" >&2
  exit 1
fi

# Template the same release as an install, PostgreSQL upgrade, and SQLite
# rollback. Rollback rendering must reproduce the original SQLite resources.
helm template lifecycle "${chart}" --namespace lifecycle \
  > "${workdir}/lifecycle-install.yaml"
helm template lifecycle "${chart}" --namespace lifecycle --is-upgrade \
  --values "${postgres_external_example}" > "${workdir}/lifecycle-upgrade.yaml"
helm template lifecycle "${chart}" --namespace lifecycle --is-upgrade \
  > "${workdir}/lifecycle-rollback.yaml"
cmp "${workdir}/lifecycle-install.yaml" "${workdir}/lifecycle-rollback.yaml"
grep -A1 'name: DATABASE_DRIVER' "${workdir}/lifecycle-upgrade.yaml" | grep -q 'value: "postgres"'

digest="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
helm template digest-test "${chart}" --set-string "image.digest=${digest}" \
  > "${workdir}/digest.yaml"
grep -q "ghcr.io/hackepeter87/betreuungskalender@${digest}" "${workdir}/digest.yaml"

if helm template invalid-replicas "${chart}" --set replicaCount=2 >/dev/null 2>&1; then
  echo "replicaCount=2 must be rejected" >&2
  exit 1
fi

if helm template invalid-secret "${chart}" \
  --set-string config.OIDC_CLIENT_SECRET=not-a-real-secret >/dev/null 2>&1; then
  echo "known secret keys in config must be rejected" >&2
  exit 1
fi

if helm template invalid-ingress "${chart}" --set ingress.enabled=true >/dev/null 2>&1; then
  echo "enabled ingress without a host must be rejected" >&2
  exit 1
fi

if helm template invalid-path "${chart}" \
  --set-string runtime.databasePath=/other/app.sqlite >/dev/null 2>&1; then
  echo "database paths outside the data mount must be rejected" >&2
  exit 1
fi

if helm template invalid-database-type "${chart}" \
  --set-string database.type=postgres >/dev/null 2>&1; then
  echo "unknown database modes must be rejected" >&2
  exit 1
fi

if helm template incomplete-external "${chart}" \
  --set-string database.type=postgres-external >/dev/null 2>&1; then
  echo "incomplete external PostgreSQL values must be rejected" >&2
  exit 1
fi

if helm template sqlite-with-postgres-settings "${chart}" \
  --set-string database.postgres.host=postgres.example.invalid >/dev/null 2>&1; then
  echo "SQLite mode must reject unnoticed PostgreSQL connection values" >&2
  exit 1
fi

if helm template external-without-ca "${chart}" \
  --values "${postgres_external_example}" \
  --set-string database.postgres.tls.caSecret.name= >/dev/null 2>&1; then
  echo "verify-full PostgreSQL without a CA Secret must be rejected" >&2
  exit 1
fi

if helm template external-contradictory-tls "${chart}" \
  --values "${postgres_external_example}" \
  --set-string database.postgres.tls.mode=disable >/dev/null 2>&1; then
  echo "disabled PostgreSQL TLS with a CA Secret must be rejected" >&2
  exit 1
fi

if helm template invalid-evaluation-tls "${chart}" \
  --values "${postgres_evaluation_example}" \
  --set-string database.postgres.tls.mode=verify-full >/dev/null 2>&1; then
  echo "embedded evaluation PostgreSQL must use only its internal transport" >&2
  exit 1
fi

if helm template ephemeral-evaluation "${chart}" \
  --values "${postgres_evaluation_example}" \
  --set database.embeddedEvaluation.persistence.enabled=false >/dev/null 2>&1; then
  echo "embedded evaluation PostgreSQL must require persistent storage" >&2
  exit 1
fi

if grep -R -E '(password|secret)[[:space:]]*:[[:space:]]*[^[:space:]]+' \
  "${chart}/examples/postgresql-"*"-values.yaml" | grep -v -E '(passwordSecret|key: password)' >/dev/null; then
  echo "PostgreSQL examples must not contain secret values" >&2
  exit 1
fi

echo "Helm chart validation successful."
