# ADR 0006: Kubernetes deployment with Helm and single-writer SQLite

## Status

Accepted.

## Context

The application stores domain data in SQLite and writes backups and temporary
files at runtime. A Kubernetes deployment must preserve SQLite locking,
filesystem ownership, health checks, application configuration and isolation
between independent installations. It must not assume a namespace, hostname,
ingress implementation or storage class.

## Decision

- Ship an application Helm chart in `charts/betreuungskalender`.
- Use a `Deployment` with exactly one replica and the `Recreate` strategy.
- Give each Helm release a release-scoped data claim and optional backup claim.
- Keep generated claims on uninstall by default.
- Run as UID/GID 1000 with `runAsNonRoot`, `RuntimeDefault` seccomp, no Linux
  capabilities, no privilege escalation and a read-only root filesystem.
- Mount only data, backups and temporary storage as writable paths.
- Use `/api/ready` for startup and readiness, and `/api/health` for liveness.
- Supply non-sensitive settings through a ConfigMap and credentials through
  existing Kubernetes Secrets.
- Support ingress and TLS without selecting a controller or certificate
  implementation.
- Support immutable container references through an optional image digest.

## Rationale

A StatefulSet does not make SQLite active-active and would imply a scaling
model the application cannot safely support. A single-replica Deployment with
`Recreate` explicitly prevents two application versions from writing the same
database during an upgrade. Release-scoped naming allows multiple independent
installations without sharing storage or service identity.

Readiness waits for both database access and applied migrations. Liveness uses
the lighter health endpoint so a process that cannot access its database is
restarted, while the startup probe gives migrations time to finish.

The chart does not create credentials. This keeps secret material out of Helm
release values and separates application packaging from cluster-specific secret
management.

## Consequences

- Application availability includes a short interruption during rollout.
- Horizontal scaling is not supported for one installation while SQLite is the
  database.
- Persistent storage must provide reliable POSIX locking and be writable by the
  configured fsGroup.
- Helm rollback cannot undo forward-only database migrations. Backup and restore
  remain the rollback boundary for incompatible schema changes.
- Cluster-specific ingress, certificate, backup-copy and network policies remain
  outside the chart.

## Relationship to ADR 0007

[ADR 0007](0007-database-persistence-drivers.md) defines a staged persistence
boundary while preserving SQLite and this ADR's single-replica deployment
contract for v1.27.0. It does not introduce another database driver or supersede
this decision.
