# Dependency maintenance

Automated dependency pull requests reduce update drift, but they do not bypass
normal review or release controls. Dependabot checks npm packages, GitHub
Actions, and container base images every Monday in bounded groups. GitHub may
raise security updates outside that weekly schedule.

Major runtime and compiler changes follow the compatibility and rollback
contract in
[ADR 0010](adr/0010-supported-runtime-and-compiler-baseline.md). They are not
treated as routine dependency maintenance.

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

## Authoritative version sources

| Component | Authoritative source | Drift expectation |
| --- | --- | --- |
| npm packages | `package-lock.json` | `package.json` declares only the reviewed compatible range or exact tool pin |
| Node.js and npm | `package.json` engines and `packageManager` | Dockerfiles and workflows use the same supported baseline |
| Container bases | `Dockerfile` and `Dockerfile.release` | Every external image keeps a readable tag and immutable digest |
| GitHub Actions | `.github/workflows/` | Every external action uses an immutable commit reference |
| PostgreSQL validation | CI and container smoke workflows | Test majors match the operator documentation |
| Release metadata | application version and Helm chart metadata | The strict release check rejects disagreement before publication |

Runtime migrations, compiler majors, database majors, and type packages for a
new runtime are coordinated packages. They must not arrive as unrelated routine
updates even when an automated pull request is available.

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

## Required vulnerability gates

- npm audit and dependency review reject unresolved high-severity package
  findings.
- CodeQL remains a required source-analysis gate.
- The release-image Trivy workflow rejects unresolved high or critical
  findings for pull requests, `main`, and scheduled scans. It still uploads the
  SARIF result when the scan fails so maintainers can review the evidence.
- Scanner disagreements are checked against the affected package ecosystem and
  the authoritative upstream or distribution security tracker. A lower score
  from another database is not by itself a reason to dismiss a finding.
- Suppressions must be component-specific, justified, time-bounded or tied to a
  review condition, and tracked separately. A broad ignore file is not an
  acceptable release shortcut.

Release-specific scan counts and dispositions belong to the release issue and
its reviewed evidence. They are intentionally not copied into this current
operating guide, where they would become stale.

## Recovery

If an update causes a regression, revert its pull request or prepare a focused
follow-up change and rerun the complete affected checks. Released installations
use the documented rollback procedure and a previously reviewed immutable
image. Dependency automation never moves `testing`, `production`, or `latest`.

See [Testing](testing.md), [Security and privacy](security.md), and
[Release process](release.md) for the surrounding gates.
