# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are parents and other caregivers who need to plan and
document childcare arrangements in private or shared self-hosted installations.
They may use the application during routine coordination as well as situations
where a neutral, chronological account is important.

Installation owners and operators are a secondary audience. They configure
access, authentication, persistence, backups, transfers, and the operator-owned
legal information for their installation.

## Product Purpose

Betreuungskalender supports neutral, traceable documentation of planned and
actual childcare periods, recurring arrangements, deviations, handovers,
travel, costs, holidays, and unavailable periods. It helps users distinguish
plans from documented outcomes and produce factual calendar, analysis, and
report views from the same entered data.

Success means that users can maintain a comprehensible record without giving
up control of sensitive family data. The application is a documentation aid.
It does not provide legal advice, create an official record, assess another
person's conduct, or guarantee that a report will be accepted by a court,
authority, lawyer, or other recipient.

## Positioning

The product combines care planning and retrospective documentation in one
self-hosted application while keeping planned, completed, partial, cancelled,
and conflicting states explicit. Domain-level caregivers remain separate from
application identities, so factual records do not depend on a particular OIDC
claim or account name.

## Operating Context

Users work with a responsive calendar and mobile agenda, recurring contact
rules, care-entry forms, confirmations, notifications, holiday and
unavailability records, reports, exports, and an audit history. Several users
may collaborate through installation memberships and explicit care-party
assignments. The same installation may use SQLite or an explicitly configured
PostgreSQL database.

The application is commonly operated through a container, Kubernetes, or a
system service. Operators remain responsible for authentication, transport
security, backups, retention, legal information, and appropriate access to the
installation.

## Capabilities and Constraints

- Sensitive information about children, caregivers, schedules, notes, costs,
  and evidence references must be handled as private data.
- Self-hosting and operator control are product boundaries. There is no central
  cloud synchronization, analytics, or external tracking.
- Authentication, active workspace membership, server-enforced permissions,
  and owner-only administrative operations must remain authoritative.
- The application supports German and English interface copy. New user-facing
  behavior must remain localizable rather than embedding one language in
  components.
- Mobile, tablet, desktop, keyboard, touch, and assistive-technology workflows
  are maintained together. Screen reports and A4 print/PDF output have distinct
  presentation requirements.
- Shared date, time-range, recurrence, conflict, and API contracts must remain
  consistent between browser and server. Persistence, authorization, and
  validation remain server-controlled.
- Historical records and audit information support traceability but do not
  constitute a qualified signature, trusted timestamp, or tamper-proof archive.
- Current guides describe the current application contract. ADRs, release
  notes, smoke-test records, and operator reviews preserve historical context
  and are not rewritten to match later releases.

## Brand Commitments

The product name is Betreuungskalender. User-facing language is calm, factual,
and non-accusatory. It describes recorded events and application state without
judging people or making legal claims.

The existing application icon, navigation logo, product name, and fictional
reference screenshots are established product assets. Replacing them requires
an explicit rebrand decision rather than an incidental interface change.

## Evidence on Hand

The repository contains product documentation, architecture decisions,
security and operator guidance, automated tests, fictional demonstration data,
and repeatable desktop and mobile screenshots. These materials can demonstrate
implemented behavior and established constraints.

The repository does not provide testimonials, legal endorsements, acceptance
by authorities, outcome statistics, or other third-party proof. Future work
must not fabricate those claims or present demonstration data as real family
data.

## Product Principles

1. Record facts neutrally and keep plans distinct from documented outcomes.
2. Keep sensitive family data under the installation operator's control.
3. Enforce identity, membership, permissions, and validation on the server.
4. Preserve traceability without overstating legal or evidentiary guarantees.
5. Make core workflows usable across devices and access methods.

## Accessibility & Inclusion

The accessibility baseline combines automated checks with manual keyboard,
screen-reader, reflow, contrast, focus, and touch review. Serious and critical
WCAG 2.0/2.1 A and AA findings in representative flows are regression failures,
but this baseline is not a claim of complete WCAG conformance or certification.

Language should remain understandable under stress, avoid blame, and expose
status, validation errors, warnings, and destructive consequences without
relying on color alone.
