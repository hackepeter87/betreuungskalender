#!/usr/bin/env bash
set -euo pipefail

chart="charts/betreuungskalender"
example="${chart}/examples/native-oidc-values.yaml"
legal_example="${chart}/examples/legal-content-values.yaml"
workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

helm lint --strict "${chart}"
helm lint --strict "${chart}" --values "${example}"
helm lint --strict "${chart}" --values "${legal_example}"

helm template family-one "${chart}" --namespace family-one \
  > "${workdir}/family-one.yaml"
helm template family-two "${chart}" --namespace family-two \
  --values "${example}" > "${workdir}/family-two.yaml"
helm template legal-content "${chart}" --namespace example \
  --values "${legal_example}" > "${workdir}/legal-content.yaml"

grep -q 'name: family-one-betreuungskalender-data' "${workdir}/family-one.yaml"
grep -q 'name: family-two-betreuungskalender-data' "${workdir}/family-two.yaml"
grep -q 'readOnlyRootFilesystem: true' "${workdir}/family-one.yaml"
grep -q 'runAsNonRoot: true' "${workdir}/family-one.yaml"
grep -q 'strategy:' "${workdir}/family-one.yaml"
grep -q 'type: Recreate' "${workdir}/family-one.yaml"
grep -Eq 'LEGAL_CONTENT_DIR: "?/run/config/legal"?' "${workdir}/legal-content.yaml"
grep -q 'mountPath: /run/config/legal' "${workdir}/legal-content.yaml"
grep -q 'readOnly: true' "${workdir}/legal-content.yaml"
grep -q 'name: betreuungskalender-operator-legal' "${workdir}/legal-content.yaml"

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

echo "Helm chart validation successful."
