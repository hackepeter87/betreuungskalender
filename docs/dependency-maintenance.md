# Dependency maintenance

Automated dependency pull requests reduce update drift, but they do not bypass
normal review or release controls. Dependabot checks npm packages, GitHub
Actions, and container base images every Monday in bounded groups. GitHub may
raise security updates outside that weekly schedule.

## Update groups

Routine compatible npm patch and minor updates are grouped separately for
production and development dependencies. Authentication, OIDC, Fastify,
database, calendar parsing, mail, validation, and PDF dependencies remain
individual changes so their behavior and security impact can be reviewed
directly. Major updates are always separate.

GitHub Actions and container bases use their own groups. Workflow actions are
pinned to full commit hashes, with a trailing version comment for readability.
Docker build stages retain a readable version tag and add the reviewed image
digest. Dependabot must update both parts together.

## Review requirements

Every dependency pull request runs the repository CI, CodeQL, dependency
review, and the applicable container and runtime checks. There is no automatic
merge, tag, image publication, chart publication, or deployment.

Reviewers must inspect the upstream changelog and the lockfile diff. Changes in
these areas require explicit human review and focused tests:

- authentication, OIDC, Fastify, cookies, sessions, and authorization;
- SQLite, PostgreSQL, Kysely, migrations, backup, and data transfer;
- ICS and recurrence parsing, PDF generation, and HTML sanitization;
- service workers, Vite, TypeScript, ESLint, and the release toolchain.

For container and workflow updates, verify the upstream repository, immutable
digest or commit, permissions, build provenance, and published release notes.
Testing promotion resolves the published version to a digest and copies that
immutable reference. Production promotion continues to require separate
approval and the same tested digest.

## Advisory triage

Classify an advisory as applicable, not applicable, accepted temporarily, or
fixed. Record affected versions, reachable application area, selected action,
and verification without publishing secrets, private deployment details, real
data, or exploit instructions.

A temporary exception must be narrow and include its rationale, affected
dependency and versions, expiry date, compensating control, owner, and a
follow-up issue. Do not add blanket audit suppressions. Recheck the exception
after dependency, runtime, or deployment changes and before its expiry.

## Recovery

If an update causes a regression, revert its pull request or prepare a focused
follow-up change and rerun the complete affected checks. Released installations
use the documented rollback procedure and a previously reviewed immutable
image. Dependency automation never moves `testing`, `production`, or `latest`.

See [Testing](testing.md), [Security and privacy](security.md), and
[Release process](release.md) for the surrounding gates.
