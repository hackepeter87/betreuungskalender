# ADR 0008: Operator-guided privacy actions

## Status

Accepted for `v1.34.0` on 2026-10-10. Privacy-action APIs, database migrations,
and user interfaces must follow this responsibility boundary and category
matrix.

## Context

The application stores information about children, care parties, workspace
members, planned and actual care, notes, costs, trips, recurring rules, audit
events, external calendars, and generated operational records. Many ordinary
delete actions are soft deletes. They remove a record from active views but do
not by themselves remove every identifying value, historical reference,
backup, export, or copy held by an external system.

An operator may decide, after its own legal and factual review, that access must
be revoked or that selected data must be detached, anonymized, deleted, or
retained. The application cannot make that decision. Applicable purposes,
legal bases, retention periods, preservation duties, third-party rights, and
the meaning of effective anonymization vary between installations and cases.

The application therefore needs a technical workflow that applies an already
approved operator decision safely. It must not present an ordinary delete
button as a complete erasure process or claim that the result covers copies
outside the live application database.

## Decision

### Responsibility boundary

The operator remains responsible for:

- verifying the requester and the scope of the request;
- deciding which data categories are in scope;
- choosing deletion, anonymization, detachment, revocation, or retention for
  each category;
- documenting any applicable reason, restriction, or exception outside the
  application; and
- handling identity-provider data, external calendar providers, downloaded
  files, logs, mail systems, and backup generations outside the live database.

The application will not ask for or store a legal basis, case narrative,
request document, court document, or free-text justification. It will execute
only the technical actions selected by an owner after a complete preview.

### Supported subjects

The first implementation supports three application subjects:

- a workspace user;
- a care party; and
- a child.

Selecting a subject identifies records directly linked by the application data
model. It does not prove that every free-text mention of a natural person has
been found. Notes, evidence references, custom locations, imported calendar
content, and previously generated files require explicit review when they may
contain identifying text.

### Action vocabulary

The workflow uses four distinct actions. They must not be presented as
interchangeable terms.

- **Revoke access:** Disable active application access and delivery channels.
- **Detach identity:** Remove the current authentication identifier from an
  application user while retaining an opaque historical application record.
- **Anonymize:** Replace approved identifying attributes with neutral values
  while retaining a record or relationship needed for the selected purpose.
- **Delete:** Remove an approved record or relationship from the live database
  when referential and shared-data checks allow it.

An action can be blocked. The application must not silently downgrade a
requested deletion to a soft delete or call pseudonymized data anonymous.

### Data-category decision matrix

The matrix defines available technical actions, not a universal legal answer.
The owner selects the approved action during review.

| Data category | Available technical action | Required safeguard |
| --- | --- | --- |
| Active membership and care-party assignments | Revoke and deactivate | The current and sole owner cannot be revoked |
| Native OIDC sessions, invitations, recovery access, feeds, push subscriptions, and pending notification delivery | Revoke or delete | Recheck ownership and authorization in the transaction |
| Application-user identity | Detach and anonymize | Replace the external subject with a unique non-authenticating tombstone; clear email, groups, and display attributes; never retain the previous subject in the privacy-action record |
| Child profile | Anonymize or delete | Remove name, short name, and birth attributes when anonymizing; deletion requires relationship analysis |
| Care-party profile | Anonymize or delete | Remove the display name and approved identifying attributes; deletion requires relationship analysis |
| Care-entry child and actual-child links | Delete or detach | A shared entry may keep links for unaffected children; an entry that loses its complete meaning must be blocked or selected for deletion |
| Care entries, notes, evidence references, trips, and costs | Delete complete approved records | No heuristic text replacement; shared or ambiguous free text requires manual review |
| Contact rules and generated occurrences | Delete or detach approved scope | Completed, partial, cancelled, and manual history is handled by the same selected data action, not by recurrence cleanup rules |
| Holidays and unavailability | Delete approved records | Shared periods must not be removed solely because one linked person is in scope |
| External calendar sources and imported events | Delete approved source and derived records | Remote provider data remains an operator responsibility; source URLs never appear in reports or logs |
| Monthly closures and report metadata | Recompute, invalidate, anonymize, or retain according to the approved action | A closure must not continue to claim a data state that the privacy action changed |
| Audit events and historical actor snapshots | Anonymize identifying snapshots and remove approved captured values, or retain a minimized event | Audit usefulness does not override the selected action; no old identity value may remain in before/after payloads after approved anonymization |
| Portable-transfer actor snapshots and technical transfer state | Anonymize or delete | A later export must not reintroduce removed authentication or identity attributes |
| Downloaded reports, exports, transfer packages, logs, mail systems, identity providers, and backups | No automatic live-database action | Present explicit operator follow-up and restore-reconciliation guidance |

Where a category cannot be processed without damaging unrelated data, the
preview returns a blocker. The owner must revise the selected actions or handle
the case through a separately reviewed procedure.

### Shared records and free text

Records can concern more than one person. The application follows these rules:

1. Remove only the selected subject relationship when the remaining record is
   still meaningful and contains no approved identifying attributes of the
   selected subject.
2. Delete a complete record only when the preview proves that the selected
   action covers the complete record and does not remove another subject's
   data without an explicit decision.
3. Block automatic processing when free text or a shared aggregate cannot be
   separated reliably.
4. Never use name matching, regular expressions, language models, or other
   heuristics as proof that free text has been anonymized.

The owner interface may link to records requiring manual review, subject to the
same authorization as their normal application views. A downloaded technical
review report contains category codes and counts, not the record contents.

### Preview and execution contract

Every execution requires a fresh, side-effect-free preview.

The preview:

- resolves the subject and selected category actions;
- inventories direct relationships and dependent records;
- classifies actions as executable, warning, manual review, or blocked;
- reports aggregate counts and affected time ranges;
- identifies external-copy and restore follow-up;
- computes a canonical fingerprint over the subject, selected actions, and
  relevant current database state; and
- writes no database row, audit event, file, or mapping state.

Execution receives the exact selected actions and preview fingerprint. It
repeats authorization, ownership, relationship, and state validation inside a
single database transaction. A changed fingerprint returns
`409 privacy_action_preview_changed` without modifying data.

The first API contract is owner-only:

```text
POST /api/privacy-actions/preview
POST /api/privacy-actions/execute
GET  /api/privacy-actions/:id/result
```

Responses use stable category and warning codes. They carry
`Cache-Control: no-store`. Driver errors, SQL, authentication identifiers,
source URLs, tokens, names, email addresses, and record contents are never
included in public errors or normal application logs.

### Identity detachment and future authentication

The external authentication subject is replaced with a newly generated,
unique tombstone that cannot be produced by a supported authentication mode.
The previous subject is not retained in the privacy-action tables, audit
payload, or log output.

If the same external identity authenticates later, it is treated as a new
application user without a membership. It must not inherit the detached user's
role, care-party assignments, feeds, notifications, or historical actor
mapping. Normal invitation and owner-controlled membership rules remain the
only access path.

The stable historical application-user identifier can remain where required by
foreign keys. It is pseudonymous data and remains subject to the approved
retention decision; it is not described as anonymous merely because the OIDC
subject was removed.

### Sole-owner safeguard

The application rejects an action that would revoke, detach, anonymize, or
delete the current or sole owner while the installation still depends on that
owner. Ownership must first be transferred through a separately authorized
workflow. A privacy action cannot create a second owner or bypass the existing
membership model.

### Minimal completion record

The application retains only the technical record needed to make execution
idempotent and to show what the application did:

- generated action identifier;
- execution status and timestamps;
- executing owner identifier;
- stable action and category codes;
- aggregate affected-record counts; and
- abstract failure code, when applicable.

The record does not retain the requester's narrative, legal assessment,
previous identity subject, email address, names, original field values, notes,
URLs, tokens, or exported report. A temporary target reference may exist while
an action is pending and is cleared when the transaction completes or is
abandoned.

The operator chooses the retention period for this technical record. The
application documentation must not prescribe a universally valid period.

### Backups, exports, and restore reconciliation

The live workflow does not modify existing backup generations, downloaded
reports, exports, portable transfer packages, or copies held by external
systems.

The result must state that:

- bundled SQLite backup retention expires whole generated files only;
- PostgreSQL backup and point-in-time retention is operator-managed;
- controlled downloaded copies require separate handling;
- external identity, calendar, mail, push, proxy, and logging systems require
  separate review; and
- restoring a database from before the action requires the operator to repeat
  or reconcile the privacy action before ordinary use resumes.

The implementation does not claim completion for copies it cannot inspect or
control.

### Database and migration boundary

SQLite and PostgreSQL use the same domain planning and execution services. Any
new schema is added through matching migrations in the same change. The schema
stores technical workflow state only and must not duplicate subject attributes
or legal reasoning.

Execution is one explicit transaction. Post-action checks cover foreign keys,
database integrity, domain references, owner invariants, transfer behavior,
and authorization. A failed check rolls back the complete action.

### Security and privacy controls

- Routes are owner-only and use the existing server authorization boundary.
- Rate limits and request-size limits are stricter than ordinary domain
  writes.
- Preview and execution recheck authorization and current ownership.
- The browser is not trusted to determine categories, counts, or eligibility.
- CSRF, origin, session, and trusted-proxy protections remain unchanged.
- Responses and result downloads are not cached.
- No request body or selected personal data is logged.
- Audit events use an abstract action type and aggregate counts only.
- Tests use obviously fictional identities and records.

## Delivery sequence

1. Approve this decision and its category matrix.
2. Implement the inventory and preview contract.
3. Implement access revocation and identity detachment.
4. Implement approved profile and historical-actor anonymization.
5. Implement approved domain-record actions and transactional checks.
6. Add the owner review and confirmation interface.
7. Complete operator guidance and cross-database acceptance.
8. Publish only after the separate release and testing-acceptance gates pass.

No later step starts while an earlier contract remains unresolved.

## Required verification

- Dry runs leave tables, sequences, audit history, files, and timestamps
  unchanged.
- Stale fingerprints and concurrent changes are rejected without partial work.
- Current-owner and sole-owner actions are blocked.
- Revoked identities cannot use existing sessions, invitations, feeds, push
  subscriptions, or fallback authorization.
- A later login with the former external subject receives no historical access.
- Shared records retain unaffected subjects and block ambiguous changes.
- Approved anonymization removes previous identifiers from APIs, reports,
  audit payloads, exports, and portable transfers.
- Failed execution rolls back fully.
- SQLite and PostgreSQL produce equivalent previews and results.
- Logs, errors, downloads, and audit events contain no prohibited content.
- Restore guidance is tested with a fictional pre-action backup.
- Desktop and mobile review flows pass keyboard, screen-reader, focus, touch,
  and overflow checks.

## Consequences

- The application gains a controlled technical process but does not become the
  decision-maker for retention or erasure.
- Some cases remain manual because shared free text cannot be separated safely.
- Historical usefulness can decrease after an approved anonymization or
  deletion; the preview makes that effect explicit.
- Backup completion remains bounded by the operator's actual generation expiry
  and restore procedure.
- A future audit-integrity design must respect these actions and cannot assume
  that every historical value is immutable.

## Relationship to later work

[RFC #488](https://github.com/hackepeter87/betreuungskalender/issues/488)
remains blocked until this decision is accepted. Audit-integrity mechanisms
must not prevent an approved privacy action or create misleading claims of
immutability, anonymity, or legal proof.
