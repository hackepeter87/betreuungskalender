# ADR 0010: Supported runtime and compiler baseline

## Status

Accepted for `v1.36.0`. Dependency changes, runtime image updates, validation,
release preparation, and manual testing are implemented in separate issues.

## Context

The application currently builds and runs on Node.js 24, uses the TypeScript 5
compiler line, and loads optional local environment files through dotenv's
preload entry point. The next major versions of these components do not have the
same adoption constraints:

- Node.js 26 must be an official, security-patched LTS release before it can
  become the production baseline.
- TypeScript 7 changes the compiler implementation and tooling interface. The
  current type-aware linting stack does not yet support that native compiler as
  a normal release dependency.
- TypeScript 6 is the supported transition line for resolving compiler
  deprecations without disabling the repository's strictness settings.
- dotenv 18 removes the preload entry point used by the server and operational
  scripts, so it requires an explicit initialization boundary rather than a
  routine lockfile update.
- Vite 8 is already part of the current application baseline and therefore is
  not another major migration in this release.

Runtime, compiler, linting, containers, CI, release automation, backup and
restore scripts, and operator documentation form one compatibility contract.
Updating only one declaration would create an untested split baseline.

## Decision

### Node.js 26 production baseline

`v1.36.0` adopts Node.js 26 for development checks, GitHub Actions, container
builds, the published runtime image, and the documented direct-runtime fallback.
The pin is made only after an official patched Node.js 26 LTS build is available.
A Current-channel or known pre-security build is not eligible for release.

Build and runtime images remain pinned by reviewed immutable digest. Package
engines, Node.js type definitions, npm, CI setup, Dockerfiles, runtime
verification, Helm documentation, and release checks must describe the same
supported line.

For this release only, release CI also runs a bounded Node.js 24 rollback check.
It covers dependency installation, type checking, build, core tests, server
startup, backup, and restore verification. This job provides rollback evidence;
it does not make Node.js 24 a second normal production baseline. Its removal is
tracked explicitly after `v1.36.0` testing acceptance.

### TypeScript 6 transition line

The repository moves all maintained compiler projects to the latest compatible
TypeScript 6 patch before considering TypeScript 7. Browser, server, shared,
Vite, Playwright, E2E, and maintained script projects move together.

The migration preserves strict mode, checked indexed access, exact optional
property semantics, project coverage, and type-aware boundary linting. Compiler
diagnostics are resolved at their owning boundary. The transition must not use
`ignoreDeprecations`, broad assertions, disabled lint rules, or reduced project
coverage to hide incompatibilities.

Native TypeScript 7 remains a separate blocked architecture decision until the
selected linting, editor, build, and test tooling officially supports its
compiler and language-service interfaces. No preview compiler or permanent
dual-compiler workaround enters release CI.

### Explicit environment initialization

dotenv 18 is adopted through one explicit configuration initialization path for
the server and maintained operational scripts. A local `.env` file remains
optional. Existing process environment variables retain precedence, and invalid
runtime configuration continues to fail through the existing validated
configuration boundary.

Environment values, file contents, credentials, deployment-specific paths, and
secret-bearing diagnostics must not appear in logs, public issues, or test
artifacts. The change adds no new configuration source or secret manager.

### Dependency and release boundaries

Automated update proposals remain inputs to review, not authorization to merge.
Open runtime, compiler, type-definition, container, and dotenv proposals are
reconciled against the accepted baseline and superseded when their assumptions
no longer match it. Unrelated dependency updates are not bundled solely because
they are available.

The migration is delivered in ordered packages:

1. record this compatibility and rollback contract;
2. migrate TypeScript 6 and explicit environment initialization in independently
   reviewable changes;
3. adopt the first eligible patched Node.js 26 LTS runtime;
4. align dependency automation, declarations, documentation, and drift checks;
5. run cross-runtime, database, authentication, container, and artifact
   validation;
6. prepare the release and validate the exact immutable artifact on `testing`.

The release cannot be prepared while the preceding release's testing acceptance
is still open. `production` and `latest` require separate explicit approval.

## Alternatives considered

### Adopt TypeScript 7 directly

Rejected for this release. Doing so before the type-aware linting ecosystem
supports the native compiler would require unsupported combinations, reduced
lint coverage, or a long-lived compatibility workaround.

### Keep TypeScript 5 until TypeScript 7 is ready

Rejected. TypeScript 6 provides the intended compatibility bridge and exposes
transition diagnostics while the current compiler API remains supported.

### Keep dotenv 17 or remove local file loading

Rejected. Holding dotenv would retain avoidable dependency drift, while removing
optional local loading would break documented direct-development and systemd
workflows. Explicit initialization preserves current behavior without relying
on the removed preload entry point.

### Move immediately to Node.js 26 Current

Rejected. Production and release CI require the supported LTS and security
baseline, not an earlier Current-channel build.

### Support Node.js 24 and 26 indefinitely

Rejected. A permanent matrix would increase CI cost and allow behavior to drift.
The Node.js 24 check is deliberately release-scoped and has a removal condition.

## Consequences

- `v1.36.0` is an operational compatibility release with no intended product,
  API, authorization, persistence, or user-interface change.
- Runtime-bearing declarations and workflows gain automated drift checks.
- The Node.js 26 package remains blocked until an eligible official LTS image is
  available and its immutable references have been reviewed.
- TypeScript 7 is evaluated later under its own entry criteria.
- Rollback to the prior runtime is supported by one release-specific evidence
  job rather than an indefinitely maintained second baseline.

## Required verification

- All named TypeScript projects and type-aware lint boundaries remain active.
- Local Mode, native OIDC, and trusted proxy startup paths pass without exposing
  configuration values.
- SQLite and PostgreSQL schema, CRUD, transfer, backup, restore, and readiness
  checks pass on the production runtime.
- Explicit environment loading is tested with no file, a synthetic file,
  pre-existing process values, and invalid configuration.
- Browser, PWA, report/PDF, E2E, container, Helm, CodeQL, dependency review,
  image scan, runtime-security, and strict release checks pass.
- Application version, source commit, Node.js runtime, package metadata, image
  digest, chart metadata, and current documentation agree.
- The exact published image is promoted only to `testing` and receives a
  separately documented manual acceptance using fictional data.

## References

- [Node.js release schedule](https://github.com/nodejs/Release#release-schedule)
- [TypeScript native ports project](https://github.com/microsoft/typescript-go)
- [typescript-eslint dependency versions](https://typescript-eslint.io/users/dependency-versions/)
- [dotenv releases](https://github.com/motdotla/dotenv/releases)
