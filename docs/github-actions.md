# GitHub Actions usage

This repository keeps pull-request feedback fast while preserving the full
release and security gates. Workflow selection is based on changed file classes;
unknown or unresolvable change ranges fail closed and select all relevant
checks.

## Measured baseline

The baseline uses GitHub's workflow and job APIs for the complete UTC interval
from 2026-09-24 through 2026-09-30. It contains 144 workflow runs and 411 jobs.
Linux usage is shown both as elapsed runner time and as estimated billed minutes,
where every job is rounded up to a full minute. Queue time is excluded.

| Workflow | Runs | Jobs | Actual runner minutes | Estimated billed minutes | Main trigger pattern |
| --- | ---: | ---: | ---: | ---: | --- |
| CI | 27 | 189 | 427 | 545 | 15 pull requests, 12 `main` pushes |
| Container | 40 | 120 | 148 | 218 | 14 pull requests, 26 pushes |
| Trivy | 28 | 28 | 35 | 56 | pull requests, `main`, weekly |
| CodeQL push analysis | 12 | 24 | 34 | 44 | `main` pushes |
| Dependency review | 15 | 15 | 2 | 15 | every pull request |
| Other release and maintenance workflows | 22 | 35 | 35 | 52 | tags, releases, dispatch, automation |
| **Total** | **144** | **411** | **681** | **930** | |

The largest jobs were E2E (300 actual minutes), the optional PostgreSQL
Compose smoke test (61), the release-runtime container test (45), the base
container validation (41), Trivy (35), PostgreSQL 16 (32), PostgreSQL 18 (31),
and Validation (34).

Thirteen Container run groups used the same commit for a branch push and pull
request, accounting for about 141 billed job-minutes; one copy of those groups
was redundant. Fourteen runs were superseded before completion. Their
overlapping tails consumed about 32 runner-minutes after a newer run had begun.

This fixed interval is intentionally used instead of a calendar-month query:
the GitHub API capped the broader query at 1,000 runs. Future comparisons must
use the same API fields, rounding rule, and a complete bounded interval.

## Trigger and gate policy

### Pull requests

`CI` always runs the fast `Validation` job. It checks the release metadata,
documentation and workflow contracts, then runs type checking, ESLint, unit
tests, and a production build when application files changed. The validated
build is passed to E2E as a one-day artifact; dependencies continue to use the
lockfile-keyed npm cache and are installed independently in each trust boundary.

The following jobs run only after Validation succeeds and only for matching
changes:

- E2E for browser, application, shared contract, or build-input changes;
- PostgreSQL 18 parity for server, shared contract, migration, or dependency
  changes;
- runtime security for server, shared contract, security-script, or dependency
  changes;
- Helm and update/rollback checks for their deployment inputs;
- container runtime and PostgreSQL Compose tests for their respective image and
  persistence inputs;
- Dependency Review only for dependency, image, chart, action, or workflow
  changes;
- Trivy only for application-image inputs.

`Required quality gates` is the stable aggregate CI result. It fails when
Validation or any selected downstream gate fails and accepts only deliberately
skipped, out-of-scope jobs. Existing `Validation` naming is retained for
compatibility. At the time of the baseline, `main` had no configured GitHub
branch-protection rule; this change does not modify repository protection.

### Main, schedules, and releases

CI and applicable image checks run again on the merged `main` commit. Feature
branch pushes no longer duplicate Container checks already attached to the pull
request. Pull-request workflows cancel older runs for the same pull request.

The weekly Trivy scan remains unconditional and fail-closed even when no source
file changed. Its concurrency group prevents overlapping scheduled runs. GitHub
default CodeQL setup remains enabled and externally managed; its measured cost
is retained in the estimate.

Tag validation, release image and chart publication, and testing/production
promotion retain all existing checks and permissions. They are serialized per
release or channel and never use automatic cancellation. No release or security
gate is selected through a path filter.

## Expected usage

Applied to a comparable code-heavy seven-day interval, the conservative model
is 740-800 billed job-minutes instead of 930, and approximately 540-590 actual
runner-minutes instead of 681. This is an expected reduction of 14-20%; periods
with documentation, roadmap, or workflow-only pull requests should save more.

The estimate includes the cost of the stable aggregate gate and does not claim
savings from default CodeQL. It primarily removes exact branch/PR duplication,
superseded-run tails, the second PostgreSQL version on pull requests, unnecessary
dependency and image scans, repeated E2E builds, and unrelated expensive suites.
PostgreSQL 16 and 18 both remain covered on `main` and release preparation.

## Deliberate exceptions and risks

- Change classification is conservative. Missing history or an invalid base SHA
  selects all tracked files and therefore runs more checks, never fewer.
- npm's download cache is shared by lockfile hash through `setup-node`; build
  directories, databases, credentials, and test state are never cached.
- The E2E build artifact is short-lived and contains only compiled application
  output. Container and release jobs rebuild independently because they validate
  separate packaging boundaries.
- Path filters cannot inspect semantic coupling. Workflow contract tests protect
  the maintained file classes, and changes to package manifests select every
  dependent gate.
- Pull requests use PostgreSQL 18 for immediate parity feedback. PostgreSQL 16
  and 18 remain mandatory on `main`, so supported-version drift remains visible
  before release.

Run the static workflow contract locally with:

```bash
npm run test:workflow-contracts
```

