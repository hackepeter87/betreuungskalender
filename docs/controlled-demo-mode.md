# Controlled demo mode

Controlled demo mode is a disabled-by-default application contract for a shared,
fictional demonstration dataset. It is not enabled by installing a release and
must not be treated as an ordinary staging profile. Deployment activation and
public exposure require separate operator approval.

## Preparation and activation boundary

`DEMO_DATASETS_ENABLED` and `DEMO_MODE_ENABLED` must never be enabled together.
Preparation is deliberately two-stage:

1. While controlled demo mode is off, an administrator may use the existing
   synthetic edge-case dataset loader. Loading it replaces current domain data.
2. The operator verifies that the database contains only the expected fictional
   children and care parties, disables the loader, and enables controlled demo
   mode through deployment configuration.

On the first controlled reset, the application verifies the complete set of
active fictional child and care-party identifiers. Missing or additional
identifiers fail closed. Unexpected database contents are not replaced.

## Reset contract

The current seed version is `controlled-demo-v1`. Seed identifiers stay stable,
while dates are generated relative to the reset week. The application stores
the seed version, session generation, last successful reset, next due time,
state, and a bounded abstract error code in application settings.

A reset is due at every full UTC hour. The application blocks new writes and
waits for accepted writes to finish. One SQLite transaction then replaces only
the fictional domain dataset, increments the session generation, and revokes
active application OIDC sessions. Users must sign in again. Concurrent reset
attempts share one execution.

The reset covers care entries and their dependent trips, costs, confirmations,
holidays, recurring rules, unavailability, external calendar fixtures, month
closures, and fictional child records. It updates stable fictional care-party
records in place so explicit membership data scopes remain valid.

The reset does not recreate or remove application users, memberships,
care-party assignments, invitations, recovery access, security configuration,
notification preferences, feed credentials, audit history, or general
settings. Their retention and deletion rules are separate from this reset.

## Failure and restart behavior

If the transaction fails, domain changes and session revocations roll back.
Writes remain blocked, and the anonymous projection stops serving a failed or
overdue generation. Only the abstract `demo_reset_failed` code is persisted or
logged; fixture contents and identity data are not included.

If the process stops while a reset is marked as running, startup treats it as
interrupted and performs a new atomic reset before the public projection can be
served. There is no public reset endpoint. Do not fall back to an unrestricted
normal application after a reset failure.

## Backup, restore, and rollback

Normal SQLite backup and restore procedures still apply. A restored database
must contain the exact supported fictional identity set and compatible reset
settings. Missing, malformed, overdue, or mismatched state fails closed; an
arbitrary backup is never silently converted into a demo dataset.

Before rolling back to a release that does not understand the current seed,
block demo access and restore a compatible backup if needed. Verify membership
and fictional data before reopening. The reset never deletes the database file
or rotates OIDC, tunnel, push, or other deployment identities.

## Verification

Tests use a real migrated SQLite database and cover atomic replacement,
preserved memberships and assignments, session invalidation, rollback,
concurrency, interrupted-startup recovery, unexpected seed contents, relative
dates, and disabled-mode regression. Controlled demo mode remains SQLite-only;
normal SQLite and PostgreSQL installations are unchanged while it is disabled.
