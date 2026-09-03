# Kubernetes deployment with Helm

The chart in `charts/betreuungskalender` installs the application without
assuming a namespace, hostname, ingress controller or storage class. Each Helm
release is an independent installation. SQLite remains the default; PostgreSQL
must be selected explicitly.

## Prerequisites

- Kubernetes 1.27 or newer and Helm 3
- Persistent storage with reliable POSIX locking for SQLite, or an existing
  PostgreSQL 16-18 service
- A private values file and existing Kubernetes Secrets
- An ingress controller and TLS Secret for browser access
- A verified backup and restore procedure

Do not commit private values, Secret manifests, database files or backups.

Operator-provided legal information can be mounted from a ConfigMap through the
existing extra-volume interfaces. See
[operator legal information](legal-information.md) for the reviewed read-only
mount shape; do not put unrelated secrets in the legal-content ConfigMap.

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

## Select the database

With no database values, the chart renders the established SQLite deployment
and its application data claim. See
`charts/betreuungskalender/examples/postgresql-external-values.yaml` for the
external PostgreSQL shape. It requires an existing password Secret and, with
the default `verify-full` TLS mode, an existing CA Secret:

```bash
kubectl create secret generic betreuungskalender-postgres \
  --namespace example --from-file=password=/private/path/postgres-password
kubectl create secret generic betreuungskalender-postgres-ca \
  --namespace example --from-file=ca.crt=/private/path/postgres-ca.crt
```

The referenced database must already exist. Its dedicated non-superuser role
must own the application schema and be able to create tables, indexes, and the
migration lock. The chart does not create credentials or database objects
outside the application schema. Keep database and Secret names in a private
values file and keep all secret values out of Helm values and rendered output.

`charts/betreuungskalender/examples/postgresql-evaluation-values.yaml` renders
one internal PostgreSQL StatefulSet and a retained PVC. This mode is for
evaluation only. It has no database operator, automatic backup, failover, high
availability, or production support. It also requires an existing password
Secret. Use `postgres-external` for an operational PostgreSQL deployment.

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

## Filesystem and persistence

The release image runs as the unprivileged `node` user (UID/GID 1000). The chart
uses the same UID/GID and fsGroup, a read-only root filesystem, and writable
mounts only for:

- `/data`: SQLite database and WAL/SHM sidecar files
- `/backups`: in-app backup output; persistent only when enabled
- `/tmp`: bounded `emptyDir` for temporary runtime files

In a PostgreSQL mode, the application does not render or mount `/data` and does
not create its SQLite claim. It mounts only the referenced password and optional
CA Secret in addition to backup and temporary paths. The evaluation database
uses its own retained PVC and separate Service selector; the application Service
does not select database pods.

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

For SQLite, enable `persistence.backups.enabled` when in-app backups must survive
pod replacement. A separate process should copy verified backups outside the
cluster failure domain; that process is not part of this application chart.
For PostgreSQL, this volume is not a database backup. Maintain a logical backup
and tested restore through the database service and keep it outside the database
failure domain. See [database backends](database-backends.md).

Before an upgrade:

1. Create and verify a current driver-appropriate backup.
2. Render and review the changed chart values.
3. Upgrade with `--wait` and verify `/api/ready`.
4. Run `helm test` and the application runtime verification.

Generated SQLite and evaluation-database PVCs are retained on uninstall by
default. Confirm the retained claim before reinstalling with the same release
name. Helm rollback changes Kubernetes resources but cannot reverse database migrations;
restore a verified compatible backup for an incompatible downgrade.

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

No PodDisruptionBudget or autoscaler is created: every supported database mode
currently requires one application replica, and those resources would imply
availability or scaling guarantees the application does not provide.
