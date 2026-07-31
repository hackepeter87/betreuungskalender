# Kubernetes deployment with Helm

The chart in `charts/betreuungskalender` installs the application without
assuming a namespace, hostname, ingress controller or storage class. Each Helm
release is an independent installation with its own SQLite claim.

## Prerequisites

- Kubernetes 1.27 or newer and Helm 3
- Persistent storage with reliable POSIX locking
- A private values file and existing Kubernetes Secrets
- An ingress controller and TLS Secret for browser access
- A verified backup and restore procedure

Do not commit private values, Secret manifests, database files or backups.

## Prepare credentials

Create credentials with your normal Kubernetes access controls. The chart only
references existing Secrets. This abstract example creates an OIDC client
credential without showing its value:

```bash
kubectl create secret generic betreuungskalender-runtime-secrets \
  --namespace example \
  --from-literal=oidc-client-secret
```

Interactive input avoids placing the value in this document, but shell history
and local process visibility still depend on the local command environment. An
existing Secret can instead be referenced with `extraEnvFrom`.

## Configure and install

Start from
`charts/betreuungskalender/examples/native-oidc-values.yaml`, replace all
placeholder hostnames, select the storage class, and reference existing Secrets.
Keep credentials out of `config`.

```bash
helm lint --strict charts/betreuungskalender --values private-values.yaml
helm template family-calendar charts/betreuungskalender \
  --namespace example --values private-values.yaml > rendered.yaml
helm upgrade --install family-calendar charts/betreuungskalender \
  --namespace example --create-namespace \
  --values private-values.yaml --wait --timeout 5m
helm test family-calendar --namespace example
```

Use the release image digest asset when available. An immutable digest prevents
a mutable tag from changing the deployed image unexpectedly.

## Filesystem and SQLite

The release image runs as the unprivileged `node` user (UID/GID 1000). The chart
uses the same UID/GID and fsGroup, a read-only root filesystem, and writable
mounts only for:

- `/data`: SQLite database and WAL/SHM sidecar files
- `/backups`: in-app backup output; persistent only when enabled
- `/tmp`: bounded `emptyDir` for temporary runtime files

The app enables SQLite WAL mode and a busy timeout. This supports concurrent
requests inside one process, not multiple application writers. The chart
therefore rejects more than one replica and any rollout strategy other than
`Recreate`.

Do not use an RWX claim to bypass this restriction. Network storage must be
explicitly verified for SQLite locking and durability. `ReadWriteOncePod` is
preferable when the storage driver supports it; `ReadWriteOnce` is the portable
default.

## Health checks

- Startup: `/api/ready` waits for database access and migrations.
- Readiness: `/api/ready` removes the pod from service when it is not ready.
- Liveness: `/api/health` checks the process and database connection.

Probe timing is configurable. Increase the startup failure threshold when the
storage backend has predictably slow attachment or migrations. Do not replace
the readiness probe with a static frontend path.

## Ingress, TLS and public URLs

The ingress terminates TLS and forwards HTTP to the ClusterIP Service. Configure
`ALLOWED_ORIGIN`, OIDC redirect URLs, logout URL, invitation base URL and Web
Push subject for the exact public HTTPS origin. The chart does not create TLS
certificates.

Native OIDC does not trust identity headers from the ingress. If trusted-proxy
authentication is deliberately selected, direct access to the Service must be
restricted and `TRUSTED_PROXY_CIDRS` must match the actual source addresses
observed by the application.

## Backups and upgrades

Enable `persistence.backups.enabled` when in-app backups must survive pod
replacement. A separate process should copy verified backups outside the
cluster failure domain; that process is not part of this application chart.

Before an upgrade:

1. Create and verify a current backup.
2. Render and review the changed chart values.
3. Upgrade with `--wait` and verify `/api/ready`.
4. Run `helm test` and the application runtime verification.

Generated PVCs are retained on uninstall by default. Confirm the retained claim
before reinstalling with the same release name. Helm rollback changes
Kubernetes resources but cannot reverse database migrations; restore a verified
compatible backup for an incompatible downgrade.

## Multiple installations

Install each instance with a distinct release name and preferably a distinct
namespace. Services, Deployments, ServiceAccounts and generated PVCs are named
from the release, so no hostname or namespace is hardcoded. Existing claims and
Secrets remain namespace-scoped and must be supplied separately for each
installation.

## Scheduling and policy controls

The chart exposes node selectors, tolerations, affinity, topology spread
constraints, labels and annotations. It does not create a NetworkPolicy because
OIDC discovery, SMTP, Web Push and external calendar feeds can require different
egress destinations. Apply cluster-specific ingress and egress policy after
reviewing the enabled application features.

No PodDisruptionBudget or autoscaler is created: the supported replica count is
one, and those resources would imply availability or scaling guarantees that
SQLite cannot provide.
