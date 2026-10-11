# ADR 0009: Explicit member access and care-data scopes

## Status

Accepted for `v1.35.0`. The schema, authorization, API, and user-interface
changes are implemented separately in the linked release packages.

## Context

The application uses fixed workspace roles and owner-only administration as
defined in [ADR 0005](0005-workspace-permissions.md). A separate assignment
table currently limits non-admin care-party access only after any active
assignment exists anywhere in the installation. This makes the effective
result difficult to explain before an invitation or role change and couples a
member's access to unrelated assignments.

The application needs an owner-facing model that answers two distinct
questions without introducing configurable permission lists:

1. Which operations does the fixed workspace role permit?
2. Which care-party domain records are within that member's data scope?

Browser visibility is not an authorization boundary. The server remains the
only authority for roles, scopes, response projections, and writes.

## Decision

### Effective access

Effective access is the intersection of:

- an active workspace membership;
- the fixed capabilities of its workspace role; and
- the membership's explicit care-data scope.

The installation owner remains a separate designation and retains an `admin`
membership. Owner and Admin always use the full care-data scope. Editor,
Scheduler, and Viewer use one of these scope forms:

- `all`: all active care parties in the installation;
- `selected`: exactly the referenced active care parties.

An empty `selected` scope is valid. It grants login access and the role's
global capabilities, but no care-party domain data. It must never be
interpreted as `all`.

Unknown, incomplete, or invalid scope state fails closed for care-party domain
data. The server does not infer access from identity-provider claims, the
existence of assignments belonging to other users, or client-supplied
capabilities.

### Fixed role capabilities

The permission vocabulary and server mapping in ADR 0005 remain authoritative.
The owner-facing preview groups those capabilities into stable semantic groups;
localized prose is supplied by the client and is not accepted back as an
authorization input.

| Role | Can view | Can edit | Can administer | Explicitly excluded |
| --- | --- | --- | --- | --- |
| Owner | All application data | All application data | Members, access scopes, settings, exports, privacy actions, and destructive operations | None within the application |
| Admin | Full care and planning data, settings, reports, exports, audit, and instance information | Care, children, planning, and settings | Normal application configuration | Memberships, invitations, ownership, privacy actions, and destructive replacement |
| Editor | Full in-scope care data, sensitive child data, notes, planning, and reports | In-scope care, children, and planning | Own notifications and personal feeds | Settings, members, full exports, audit, instance inspection, and destructive operations |
| Scheduler | Reduced in-scope schedule and basic child summaries | Future planned entries within the existing scheduler boundary | Own notifications | Sensitive child data, notes, actual-care confirmation, deletion, planning administration, reports, settings, feeds, members, and exports |
| Viewer | Reduced in-scope schedule and basic child summaries | Nothing | Own notifications | Sensitive data and every write, report, feed, settings, membership, export, or destructive capability |

The preview must distinguish role capabilities from data scope. A broad role
with an empty selected scope is not described as having access to care records.
Owner and Admin scope controls are not presented because those roles always
operate on `all`.

### Scope-controlled records

The explicit care-data scope applies to:

- care parties;
- care entries and their child links, trips, costs, notes, evidence metadata,
  and deviations;
- recurring care rules, patterns, generated occurrences, and rule conflicts;
- care-party-specific unavailable periods;
- care confirmations and notification delivery eligibility;
- care-derived reports, statistics, dashboard aggregates, and month summaries;
- personal calendar-feed content.

For a planned entry, the planned responsible care party determines scope. For
a completed or partially completed entry, an actual responsible care party
determines scope when present; otherwise the planned responsible care party is
used. Cancelled entries use the planned responsible care party. A record with
no responsible care party is visible only to the `all` scope.

A conflict or aggregate is visible only from records that are themselves
visible. The server must not reveal counts, identifiers, timestamps, names, or
other derived information about out-of-scope records. A conflict spanning a
visible and an invisible entry is not returned to the restricted member.

Writes must validate both the existing record and the submitted responsible
care party against the effective scope. A permitted user cannot move a record
into or out of an inaccessible scope through an identifier-level API request.

### Global records

Care-data scope is not per-child isolation. The following records remain
global and continue to be governed by role permissions and response
projections:

- child records and child summaries;
- holiday periods;
- external calendar sources and events;
- application settings, instance information, audit data, and operator data;
- membership and invitation administration.

Restricted roles still receive only the fields and endpoints permitted by ADR
0005. The access preview must identify global data that a proposed role can
receive and must not imply that selecting care parties hides child identity or
other role-visible global records.

### Invitations and membership changes

A pending invitation stores the proposed role and the proposed explicit scope.
Invitation acceptance applies both in one transaction. A role that requires
the full scope is normalized to `all`; selected references must identify active
care parties at execution time.

An owner changes role and scope through one previewed operation. Preview and
execution use the same authorization service. The preview fingerprint binds at
least the role model version, target membership, current and proposed scope,
and active referenced care parties. A stale preview changes nothing.

The owner cannot remove, downgrade, or narrow their own access. Non-owners
cannot change membership access, including their own. Client-provided
permission lists or localized descriptions are never persisted.

Scope narrowing, role reduction, and membership removal atomically invalidate
or revoke affected personal feeds, pending confirmation work, and other
user-bound delivery state. Existing browser or OIDC sessions cannot retain the
previous authorization on the next protected request.

### Migration and compatibility

The migration reproduces the currently effective data visibility without
silently broadening it:

- Owner and Admin memberships become `all`.
- If the installation has no active care-party assignments, existing
  non-admin memberships become `all`.
- If any active assignment exists, each existing non-admin membership becomes
  `selected` with exactly its active assignments; a member without assignments
  receives an empty selected set.
- Deleted memberships and deleted assignments remain inactive.

Legacy pending invitations remain valid. Admin invitations normalize to
`all`. A non-admin invitation created in an installation that had no active
assignments at migration time receives `all`; otherwise it receives an empty
selected scope and requires an owner review after acceptance. This compatibility
default is deterministic and does not infer a relationship from an email,
display name, identity-provider claim, or future assignment.

The ordered SQLite and PostgreSQL migrations implement identical constraints
and results. A native database backup includes the explicit scope records.
Portable instance transfer continues to exclude memberships, invitations,
identity-provider subjects, sessions, feed tokens, and other runtime access
state; imported domain data does not grant access on the target installation.

### Privacy and lifecycle interactions

Membership revocation and identity-detachment privacy actions remove active
scope relationships together with the existing session, feed, notification,
and invitation handling. Historical domain authorship and retained audit
snapshots do not grant current access.

Care-party anonymization or erasure invalidates references in selected scopes
as part of the same approved transaction. It must not convert `selected` to
`all`. If the last selected care party is removed, the member retains an empty
selected scope until the owner explicitly changes it.

Backup restore restores the scope state contained in that database. Operators
must recheck current memberships and access scopes after restoring an older
backup, as with other restored authorization state.

## Consequences

- Memberships and invitations gain explicit scope state and selected
  care-party relationships.
- The application no longer uses installation-wide assignment presence as a
  switch for another member's access.
- Authorization queries and projections share one effective-scope service.
- The owner can review gained and lost role capabilities and care-party access
  before applying a change.
- Empty selected scope becomes a supported, tested state rather than an
  accidental side effect.
- Per-child scope and custom permission sets remain out of scope.

## Required verification

- Table-driven tests cover every fixed role with `all`, non-empty `selected`,
  and empty `selected` where applicable.
- Direct API tests prove that reads, writes, identifiers, aggregates, reports,
  conflicts, confirmations, and feeds cannot cross the effective scope.
- Migration tests reproduce unscoped, partially assigned, unassigned, revoked,
  and pending-invitation states on SQLite and PostgreSQL.
- Preview and execution tests cover owner safeguards, invalid references,
  stale fingerprints, concurrent changes, and transaction rollback.
- Backup, restore, portable transfer, and operator privacy actions preserve the
  decisions in this ADR.
- Browser tests verify understandable role and scope summaries without
  exposing internal permission keys.

## Relationship to ADR 0005

ADR 0005 remains authoritative for fixed roles, named permissions, scheduler
write restrictions, response projections, membership authority, and owner-only
operations. This ADR replaces only its implicit care-party assignment scope
with an explicit membership and invitation data-scope contract.
