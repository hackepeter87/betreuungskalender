# Betreuungskalender Helm chart

This chart deploys one self-hosted Betreuungskalender installation with one
SQLite writer and release-scoped Kubernetes resources.

## Requirements

- Kubernetes 1.27 or newer
- Helm 3
- A `ReadWriteOnce` or `ReadWriteOncePod` storage class with POSIX file-locking
  semantics suitable for SQLite
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
| `replicaCount` | Application pods; fixed to one for SQLite | `1` |
| `image.repository` | Container repository | GHCR repository |
| `image.tag` | Container tag; defaults to chart `appVersion` | empty |
| `image.digest` | Optional immutable SHA-256 image digest | empty |
| `image.pullPolicy` | Kubernetes image pull policy | `IfNotPresent` |
| `config` | Non-sensitive application environment values | `{}` |
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

All application settings from `docs/configuration.md` can be supplied through
`config`, `extraEnv`, or `extraEnvFrom`. The schema rejects known secret keys
inside `config`; use a Kubernetes Secret reference instead.

## Persistence and upgrades

The chart deliberately enforces `replicaCount: 1` and `strategy.type:
Recreate`. SQLite WAL mode supports concurrent requests inside one process, but
not active-active application pods sharing one database. Separate Helm releases
remain independent because resource and claim names include the release name.

The generated PVCs have `helm.sh/resource-policy: keep` by default. Uninstalling
the release therefore does not delete the database or backup claim. Take and
verify a backup before every upgrade. A Helm rollback does not reverse SQLite
migrations; restore a compatible verified backup when a downgrade requires an
older schema.

Do not use storage that lacks reliable POSIX locking. Validate network-backed
storage with the storage provider before placing SQLite on it.

## Secret files

`ownerSetupSecret.existingSecret` and `recoveryAdminSecret.existingSecret`
mount selected Secret keys as read-only files. The complete Secret volume is
mounted so Kubernetes can project rotations without recreating the pod. Other
credentials should use `extraEnv` with `secretKeyRef` or `extraEnvFrom`; changes
to environment-based Secrets require a pod rollout.

See [the complete deployment guide](../../docs/deployment-helm.md) for ingress,
probes, backups, security boundaries, upgrades and troubleshooting.
