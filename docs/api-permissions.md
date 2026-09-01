# API permission inventory

This inventory implements [ADR 0005](adr/0005-workspace-permissions.md). Every
protected `/api` route must declare the listed permission in Fastify route
metadata. Unclassified protected routes are denied.

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
| `POST /api/care-entries`, `POST /api/care-conflicts/preview`, `POST /api/care-conflicts/resolve` | `appointments:create` |
| `PUT /api/care-entries/:id` | `appointments:edit` |
| `DELETE /api/care-entries/:id` | `appointments:delete` |
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

## Role mapping

| Permission group | Owner | Admin | Editor | Scheduler | Viewer |
| --- | --- | --- | --- | --- | --- |
| Appointment view and basic child summaries | Yes | Yes | Yes | Yes | Yes |
| Appointment create/edit/delete | Yes | Yes | Yes | Limited create/edit | No |
| Sensitive children, notes, planning, reports | Yes | Yes | Yes | No | No |
| Settings and exports | Yes | Yes | No | No | No |
| Member administration and destructive operations | Yes | No | No | No | No |
| Own notification preferences | Yes | Yes | Yes | Yes | Yes |
| Own personal calendar feed | Yes | Yes | Yes | No | No |
