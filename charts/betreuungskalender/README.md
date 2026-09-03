# Betreuungskalender Helm chart

This chart deploys one self-hosted Betreuungskalender installation with one
application pod and release-scoped Kubernetes resources. SQLite remains the
default; PostgreSQL must be selected explicitly.

## Requirements

- Kubernetes 1.27 or newer
- Helm 3
- For SQLite, a `ReadWriteOnce` or `ReadWriteOncePod` storage class with POSIX file-locking
  semantics
- For PostgreSQL, an operator-provided service and existing credential Secret
- An ingress controller and TLS Secret when ingress is enabled
- Existing Kubernetes Secrets for credentials

## Install

Create application credentials as Kubernetes Secrets. Do not put secret values
in a values file or Git repository. Then render and install the chart:

```bash
helm lint --strict charts/betreuungskalender \
  --values charts/betreuungskalender/examples/native-oidc-values.yaml
helm upgrade --install family-calendar charts/betreuungskalender \
  --namespace family-calendar \
  --create-namespace \
  --values private-values.yaml \
  --wait --timeout 5m
helm test family-calendar --namespace family-calendar
```

Use an immutable image digest for reproducible deployments:

```yaml
image:
  repository: ghcr.io/hackepeter87/betreuungskalender
  digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

`image.digest` takes precedence over `image.tag`. The digest above is only a
placeholder.

## Configuration

| Value | Purpose | Default |
| --- | --- | --- |
| `replicaCount` | Application pods; currently fixed to one for every database mode | `1` |
| `image.repository` | Container repository | GHCR repository |
| `image.tag` | Container tag; defaults to chart `appVersion` | empty |
| `image.digest` | Optional immutable SHA-256 image digest | empty |
| `image.pullPolicy` | Kubernetes image pull policy | `IfNotPresent` |
| `config` | Non-sensitive application environment values | `{}` |
| `database.type` | `sqlite`, `postgres-external`, or `postgres-embedded-evaluation` | `sqlite` |
| `database.postgres.*` | PostgreSQL endpoint, database, user, existing password Secret and TLS references | empty / verified TLS |
| `database.embeddedEvaluation.*` | Explicitly non-production PostgreSQL image, storage and resources | PostgreSQL 16 / `5Gi` |
| `extraEnv` | Environment entries, including `secretKeyRef` | `[]` |
| `extraEnvFrom` | Existing Secret or ConfigMap environment sources | `[]` |
| `service.type` / `service.port` | Kubernetes Service settings | `ClusterIP` / `3000` |
| `ingress.*` | Ingress class, hosts, paths, TLS, labels and annotations | disabled |
| `persistence.data.*` | SQLite PVC or existing claim | enabled, `2Gi` |
| `persistence.backups.*` | Persistent in-app backup directory | disabled |
| `persistence.tmp.*` | Writable in-memory temporary directory | `256Mi` |
| `podSecurityContext` | Pod UID/GID, fsGroup and seccomp settings | non-root UID 1000 |
| `securityContext` | Container capabilities and read-only root filesystem | hardened |
| `resources` | CPU and memory requests/limits | see `values.yaml` |
| `startupProbe` | Migration/readiness startup gate | `/api/ready` |
| `readinessProbe` | Traffic readiness | `/api/ready` |
| `livenessProbe` | Process and database health | `/api/health` |
| `nodeSelector`, `tolerations`, `affinity` | Kubernetes scheduling | empty |
| `commonLabels`, `podLabels`, `*.annotations` | Additional resource metadata | empty |

Portable transfer requests use `DATA_TRANSFER_MAX_BYTES` from `config` and are
validated in memory without creating a temporary package file. The default is
25 MiB. Configure the ingress controller to permit the same request size while
keeping the application limit as the authoritative upper bound.

`OIDC_DISPLAY_NAME_CLAIM` selects the native-OIDC display-name claim and
defaults to `preferred_username`. It does not change the stable OIDC subject or
portable-transfer identity rules.

All application settings from `docs/configuration.md` can be supplied through
`config`, `extraEnv`, or `extraEnvFrom`. The schema rejects known secret keys
inside `config`; use a Kubernetes Secret reference instead.

## Persistence and upgrades

The chart deliberately enforces `replicaCount: 1` and `strategy.type:
Recreate` for every database mode. PostgreSQL support does not make multiple
application replicas safe because application-level scheduling and background
work remain single-instance. Separate Helm releases remain independent because
resource and claim names include the release name.

`postgres-external` references an existing password Secret and, by default, an
existing CA Secret for `verify-full` transport verification. The chart never
creates database credentials. `postgres-embedded-evaluation` renders a private
ClusterIP Service, one StatefulSet and a retained PVC. It is for evaluation
only: it has no high availability, operator, automatic backup, failover or
production support. Use an operator-managed external PostgreSQL service for a
production PostgreSQL installation.

The generated PVCs have `helm.sh/resource-policy: keep` by default. Uninstalling
the release therefore does not delete the database or backup claim. Take and
verify a backup before every upgrade. A Helm rollback does not reverse SQLite
or PostgreSQL migrations; restore a compatible verified backup when a downgrade
requires an older schema.

SQLite uses the bundled application backup scripts. PostgreSQL requires an
operator-managed logical backup and tested restore; the application backup PVC
is not a PostgreSQL database backup. See
[database backends](../../docs/database-backends.md).

Do not use storage that lacks reliable POSIX locking. Validate network-backed
storage with the storage provider before placing SQLite on it.

## Secret files

Database, `ownerSetupSecret.existingSecret`, and
`recoveryAdminSecret.existingSecret`
mount selected Secret keys as read-only files. Kubernetes can refresh projected
files, but the application reads database credentials at startup, so credential
rotation requires a pod rollout. Other credentials should use `extraEnv` with
`secretKeyRef` or `extraEnvFrom`; changes to environment-based Secrets also
require a pod rollout.

See [the complete deployment guide](../../docs/deployment-helm.md) for ingress,
probes, backups, security boundaries, upgrades and troubleshooting.
