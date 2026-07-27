# ADR 0005: Workspace-scoped roles and permissions

## Status

Accepted for `v1.19.0`.

## Context

The application represents one shared workspace per installation. OIDC and
trusted-proxy authentication provide a stable external identity, but an
identity-provider role is too broad to decide which family records an invited
person may read or change.

The existing application membership, owner setting, invitation flow, and
care-party assignments are extended instead of introducing a second
authorization system. Browser navigation is not a security boundary. The
server must authorize every protected route and must remove restricted fields
before serializing a response.

## Decision

### Roles and ownership

Workspace memberships use the fixed roles `admin`, `editor`, `scheduler`, and
`viewer`. The installation owner remains a separate designation stored in
`setup.ownerUserId` and has an `admin` membership.

- The owner has every permission and is the only person who can invite, change
  roles, remove members, import or replace the complete dataset, or run other
  destructive operations.
- An admin manages children, normal care data, application settings, reports,
  and exports, but cannot administer membership or run owner-only destructive
  operations.
- An editor manages normal care data, including children and appointments, but
  cannot administer settings, members, complete exports, or destructive
  operations.
- A scheduler receives a minimal schedule view. The scheduler may create
  planned appointments and edit future planned appointments for assigned care
  parties, but cannot delete, cancel, confirm, or attach sensitive details.
- A viewer receives the same minimal schedule view without write access.

There is exactly one owner. The owner cannot remove or downgrade their own
membership through member administration.

### Named permissions

The application uses the following fixed permission vocabulary:

- `appointments:view`, `appointments:create`, `appointments:edit`,
  `appointments:delete`
- `children:view-basic`, `children:view-sensitive`, `children:manage`
- `notes:view`
- `planning:view`, `planning:manage`
- `reports:view`
- `settings:view`, `settings:manage`
- `notifications:manage-own`, `feeds:manage-own`
- `audit:view`, `instance:inspect`
- `members:manage`, `exports:run`, `admin:destructive`

The mapping is defined once in server code and returned by `/api/session`.
Clients use it to avoid presenting unavailable actions, but the server remains
authoritative.

### Scheduler write boundary

A scheduler can create only `planned` care entries for an assigned care party.
An existing entry can be edited only when it is still `planned`, its start is
in the future, and both its existing and submitted responsible care parties
are assigned to the scheduler.

Scheduler writes are limited to children, start and end, responsible care
party, and predefined location and handover fields. Notes, evidence references,
custom free-text locations, trips, costs, actual-care fields, confirmation
fields, cancellation fields, and deletion are rejected. These restrictions
are validated against the parsed server input, not inferred from UI controls.

### Response projections

Full endpoints keep their existing response shape and require the corresponding
full-data permission. Restricted roles use additive endpoints:

- `GET /api/children/summary`
- `GET /api/care-parties/summary`
- `GET /api/care-entries/schedule`

A child summary contains only its identifier, display label, and calendar
color. A schedule entry contains identifiers, child summaries, start and end,
status, responsible-party summary, a predefined location value, and a boolean
conflict marker. It excludes birth data, notes, evidence, custom locations,
trips, costs, confirmation and cancellation details, and audit metadata.

Restricted users do not receive settings, audit logs, reports, backups,
unavailability, external calendars, recurrence rules, or detailed conflict
records.

### Membership authority and compatibility

Legacy membership roles migrate as follows: `admin` to `admin`, `parent` to
`editor`, and `readonly` to `viewer`. The identity role stored on `app_users`
remains unchanged because it records the external compatibility mapping.

The latest membership record has three possible states:

- active membership: authorize with its workspace role;
- deleted membership: deny workspace access and never fall back to claims;
- no membership: use the legacy claim mapping only while no owner exists.

Once an owner exists, membership state is authoritative. An authenticated
identity without an active membership can complete a valid invitation but
cannot read workspace data. Existing installations without an owner can use
the secret-backed owner setup flow to establish ownership explicitly.

### Revocation

Removing a member soft-deletes the membership and, in the same transaction,
revokes personal calendar-feed tokens and push subscriptions. Confirmation
generation and delivery select active members only. A browser session may
remain authenticated, but the next protected request is rejected.

## Consequences

- The membership and invitation tables require an ordered SQLite migration to
  replace their role constraints while preserving rows and audit timestamps.
- Existing active users are backfilled only when they have no membership
  history. A deleted membership is never reactivated by migration.
- `/api/session` adds workspace access, role, owner, and permission fields. Its
  existing coarse role remains for one compatibility release.
- Protected routes declare permission metadata. A protected API route without
  recognized metadata is denied.
- Care-party assignment remains an additional object-level write scope and is
  not encoded as a role or permission.

## Required verification

- Migration tests cover active, missing, accepted, revoked, and deleted legacy
  states without privilege expansion.
- Route inventory tests fail for unclassified protected routes.
- Direct API tests cover each role, scheduler boundaries, owner-only actions,
  and care-party scope.
- Negative response tests prove restricted fields are absent.
- Removing a member disables API access, personal feeds, push delivery, and
  future confirmation targeting.
- Browser tests cover invitation, role change, scheduler, viewer, and revoked
  access on mobile and desktop.
