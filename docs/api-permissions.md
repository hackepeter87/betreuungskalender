# API permission inventory

This inventory implements [ADR 0005](adr/0005-workspace-permissions.md). Every
protected `/api` route must declare the listed permission in Fastify route
metadata. The registered route pattern and HTTP method determine the policy;
the raw request target does not. Unclassified protected routes are denied.

## Public and controlled onboarding routes

| Routes | Classification |
| --- | --- |
| `GET /api/health`, `GET /api/ready`, `GET /api/session` | Public |
| `POST /api/setup/first-use` | Controlled setup flow |

Invitations are accepted only through the browser link and its validated OIDC
callback. There is no public API endpoint for submitting a raw invitation
token.

## Appointments and personal notification state

| Routes | Permission |
| --- | --- |
| `GET /api/care-entries`, `GET /api/care-entries/:id`, `GET /api/care-conflicts` | `notes:view` |
| `GET /api/care-entries/schedule` | `appointments:view` |
| `POST /api/care-entries`, `POST /api/care-conflicts/preview` | `appointments:create` |
| `PUT /api/care-entries/:id` | `appointments:edit` |
| `DELETE /api/care-entries/:id`, `POST /api/care-conflicts/resolve` | `appointments:delete` |
| `GET /api/care-confirmations/open` | `notifications:manage-own` |
| `POST /api/care-confirmations/:id/answer`, `POST /api/care-confirmations/:id/remind-later` | `appointments:confirm` |
| `GET/PUT /api/notification-preferences`, `POST /api/push-subscriptions`, `DELETE /api/push-subscriptions/:id` | `notifications:manage-own` |

## Children, care parties, and planning

| Routes | Permission |
| --- | --- |
| `GET /api/children` | `children:view-sensitive` |
| `GET /api/children/summary` | `children:view-basic` |
| `POST /api/children`, `PUT/DELETE /api/children/:id` | `children:manage` |
| `GET /api/care-parties` | `planning:view` |
| `GET /api/care-parties/summary` | `appointments:view` |
| `POST /api/care-parties`, `PUT/DELETE /api/care-parties/:id` | `planning:manage` |
| `GET /api/holiday-periods`, `GET /api/unavailable-periods` | `planning:view` |
| `POST /api/holiday-periods`, `PUT/DELETE /api/holiday-periods/:id` | `planning:manage` |
| `POST /api/unavailable-periods`, `PUT/DELETE /api/unavailable-periods/:id` | `planning:manage` |
| `GET /api/contact-patterns`, `GET /api/contact-rules` | `planning:view` |
| `POST /api/contact-patterns`, `PUT/DELETE /api/contact-patterns/:id` | `planning:manage` |
| `POST /api/contact-rules`, `PUT/DELETE /api/contact-rules/:id`, `POST /api/contact-rules/:id/sync`, `POST /api/contact-rules/:id/sync-preview` | `planning:manage` |
| `GET /api/month-closings` | `reports:view` |
| `POST /api/month-closings` | `reports:view` |

## Settings, calendars, and reporting support

| Routes | Permission |
| --- | --- |
| `GET /api/settings` | `settings:view` |
| `PUT /api/settings` | `settings:manage` |
| `GET /api/external-calendars`, `GET /api/external-calendar-events` | `planning:view` |
| External-calendar create, replace, refresh, derive, update, and delete routes | `planning:manage` |
| `GET /api/external-calendar-events/export` | `exports:run` |
| `GET/POST/DELETE /api/calendar-feed` | `feeds:manage-own` |
| `GET /calendar/:token` | Scoped bearer token; never an API principal |
| `GET /api/audit-log/page` | `audit:view` |
| `GET /api/audit-log` | `audit:view`; deprecated compatibility response, limited to 500 rows |
| `POST /api/actor-labels/resolve` | `planning:view`; at most 200 referenced actor IDs |
| `GET /api/reports/snapshot` | `reports:view` |

`GET /api/settings` returns the closed `ApiAppSettings` contract only. It never
includes setup metadata or unknown stored keys. `PUT /api/settings` accepts a
partial `ApiWritableSettings` object and rejects unknown keys, invalid enum or
date values, negative or non-finite mileage rates, and references to inactive
care parties with `400`. The writable fields are the mileage rate, default
location, handover defaults, primary and default care parties, rhythm start
date, and last JSON-backup timestamp. Setup-owned `setup.*` values are not
writable through this route.

## Membership and administration

| Routes | Permission |
| --- | --- |
| `GET /api/members`, `PUT /api/members/:userId/role`, `DELETE /api/members/:userId` | `members:manage` |
| `GET /api/invitations/capabilities`, `GET/POST /api/invitations`, `DELETE /api/invitations/:id` | `members:manage` |
| `GET /api/app-users`, `GET /api/user-care-party-assignments`, `PUT /api/user-care-party-assignments/:userId` | `members:manage` |
| `GET /api/instance-readiness` | `instance:inspect` |
| `GET /api/migration/legacy-summary`, all migration POST routes | `admin:destructive` |
| `PUT/DELETE /api/app-data`, `POST /api/demo-data/edge-cases` | `admin:destructive` |
| `GET /api/data-transfer/export`, `POST /api/data-transfer/preview`, `POST /api/data-transfer/dry-run`, `PUT /api/data-transfer/import` | `admin:destructive` |
| `GET /api/data-transfer/actors`, `PUT /api/data-transfer/actors/:id/mapping`, `POST /api/data-transfer/actors/:id/invitation` | `admin:destructive` |

`admin:destructive` additionally requires the authenticated installation
owner. Possession of an admin role or a permission-shaped client value cannot
replace that server-side owner check. Before an owner has been established,
the documented trusted first-use admin compatibility remains available.

Invitation-creation responses contain the complete one-time `invitationUrl`
and invitation metadata. They do not expose the underlying bearer token as a
separate response field. Manual invitations, optional email delivery, and
historical-actor invitations use the same complete URL.

## Machine-checked protected route inventory

The following exact inventory is checked against the Fastify route metadata by
`npm run test:docs`. Grouped tables above remain the readable explanation;
this block is the completeness gate.

<!-- BEGIN PROTECTED API ROUTES -->
```text
DELETE /api/app-data | admin:destructive
DELETE /api/calendar-feed | feeds:manage-own
DELETE /api/care-entries/:id | appointments:delete
DELETE /api/care-parties/:id | planning:manage
DELETE /api/children/:id | children:manage
DELETE /api/contact-patterns/:id | planning:manage
DELETE /api/contact-rules/:id | planning:manage
DELETE /api/external-calendars/:id | planning:manage
DELETE /api/holiday-periods/:id | planning:manage
DELETE /api/invitations/:id | members:manage
DELETE /api/members/:userId | members:manage
DELETE /api/push-subscriptions/:id | notifications:manage-own
DELETE /api/unavailable-periods/:id | planning:manage
GET /api/app-users | members:manage
GET /api/audit-log | audit:view
GET /api/audit-log/page | audit:view
GET /api/calendar-feed | feeds:manage-own
GET /api/care-confirmations/open | notifications:manage-own
GET /api/care-conflicts | notes:view
GET /api/care-entries | notes:view
GET /api/care-entries/:id | notes:view
GET /api/care-entries/schedule | appointments:view
GET /api/care-parties | planning:view
GET /api/care-parties/summary | appointments:view
GET /api/children | children:view-sensitive
GET /api/children/summary | children:view-basic
GET /api/contact-patterns | planning:view
GET /api/contact-rules | planning:view
GET /api/data-transfer/actors | admin:destructive
GET /api/data-transfer/export | admin:destructive
GET /api/external-calendar-events | planning:view
GET /api/external-calendar-events/export | exports:run
GET /api/external-calendars | planning:view
GET /api/holiday-periods | planning:view
GET /api/instance-readiness | instance:inspect
GET /api/invitations | members:manage
GET /api/invitations/capabilities | members:manage
GET /api/members | members:manage
GET /api/migration/legacy-summary | admin:destructive
GET /api/month-closings | reports:view
GET /api/notification-preferences | notifications:manage-own
GET /api/reports/snapshot | reports:view
GET /api/settings | settings:view
GET /api/unavailable-periods | planning:view
GET /api/user-care-party-assignments | members:manage
PATCH /api/external-calendars/:id | planning:manage
POST /api/actor-labels/resolve | planning:view
POST /api/calendar-feed | feeds:manage-own
POST /api/care-confirmations/:id/answer | appointments:confirm
POST /api/care-confirmations/:id/remind-later | appointments:confirm
POST /api/care-conflicts/preview | appointments:create
POST /api/care-conflicts/resolve | appointments:delete
POST /api/care-entries | appointments:create
POST /api/care-parties | planning:manage
POST /api/children | children:manage
POST /api/contact-patterns | planning:manage
POST /api/contact-rules | planning:manage
POST /api/contact-rules/:id/sync | planning:manage
POST /api/contact-rules/:id/sync-preview | planning:manage
POST /api/data-transfer/actors/:id/invitation | admin:destructive
POST /api/data-transfer/dry-run | admin:destructive
POST /api/data-transfer/preview | admin:destructive
POST /api/demo-data/edge-cases | admin:destructive
POST /api/external-calendars/:id/derive-holidays | planning:manage
POST /api/external-calendars/:id/refresh | planning:manage
POST /api/external-calendars/feed | planning:manage
POST /api/external-calendars/import | planning:manage
POST /api/holiday-periods | planning:manage
POST /api/invitations | members:manage
POST /api/migration/legacy-detected | admin:destructive
POST /api/migration/legacy-import | admin:destructive
POST /api/migration/legacy-preview | admin:destructive
POST /api/migration/legacy-skip | admin:destructive
POST /api/month-closings | reports:view
POST /api/push-subscriptions | notifications:manage-own
POST /api/unavailable-periods | planning:manage
PUT /api/app-data | admin:destructive
PUT /api/care-entries/:id | appointments:edit
PUT /api/care-parties/:id | planning:manage
PUT /api/children/:id | children:manage
PUT /api/contact-patterns/:id | planning:manage
PUT /api/contact-rules/:id | planning:manage
PUT /api/data-transfer/actors/:id/mapping | admin:destructive
PUT /api/data-transfer/import | admin:destructive
PUT /api/external-calendars/:id/feed | planning:manage
PUT /api/external-calendars/:id/import | planning:manage
PUT /api/holiday-periods/:id | planning:manage
PUT /api/members/:userId/role | members:manage
PUT /api/notification-preferences | notifications:manage-own
PUT /api/settings | settings:manage
PUT /api/unavailable-periods/:id | planning:manage
PUT /api/user-care-party-assignments/:userId | members:manage
```
<!-- END PROTECTED API ROUTES -->

## Role mapping

| Permission group | Owner | Admin | Editor | Scheduler | Viewer |
| --- | --- | --- | --- | --- | --- |
| Appointment view and basic child summaries | Yes | Yes | Yes | Yes | Yes |
| Appointment create/edit/delete | Yes | Yes | Yes | Limited create/edit | No |
| Conflict preview/occurrence replacement | Yes | Yes | Yes | Assigned future preview only / No | No |
| Sensitive children, notes, planning, reports | Yes | Yes | Yes | No | No |
| Settings and exports | Yes | Yes | No | No | No |
| Member administration and destructive operations | Yes | No | No | No | No |
| Own notification preferences | Yes | Yes | Yes | Yes | Yes |
| Own personal calendar feed | Yes | Yes | Yes | No | No |
