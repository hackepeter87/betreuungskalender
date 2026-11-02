# Agent Guidance

## Mandatory issue-first delivery workflow

This repository uses GitHub issues, milestones, and the private roadmap project
as the source of truth for all planned work. An implementation request in chat
does not replace these artifacts.

Before changing code, tests, documentation, configuration, migrations, release
metadata, or deployment files, complete these steps in order:

1. Read this file and inspect the current branch and working tree without
   changing them.
2. Review the private GitHub roadmap, open issues, active milestones, and
   related release packages. Check for duplicates and existing dependencies.
3. Create or update a public, neutrally worded issue that defines the goal,
   scope, exclusions, acceptance criteria, required tests, documentation impact,
   and release constraints. Keep private operational or strategic context only
   in the private project.
4. Assign the issue to the correct milestone and set every applicable private
   project field: Status, Priority, Type, Area, Target Release, Risk, and Needs
   Decision.
5. Record dependencies with GitHub parent/sub-issue relationships where
   possible. For a versioned delivery, create a separate release and
   testing-acceptance issue that depends on all implementation issues.
6. Only after steps 1-5 are complete, create a dedicated branch from current
   `main`, move the issue to `In Progress`, and begin implementation.

If GitHub authentication, project access, or required planning information is
unavailable, stop before editing files. Restore access or ask the user how to
proceed; do not substitute an informal local patch.

After implementation:

1. Run the checks required by the issue and this file.
2. Open a draft pull request linked to the issue and milestone. The pull request
   must list completed checks and outstanding manual acceptance work.
3. Move the issue to `In Review` only when the change is reviewable. Keep the
   pull request in draft until planning, automated checks, and review gates are
   complete.
4. Use squash merge only after acceptance. Complete versioning,
   documentation, artifact validation, and testing-channel promotion through
   the separate release issue.
5. Never update `production` or `latest` without separate explicit approval.

The only exception is an active incident for which the user explicitly orders
an immediate mitigation. Keep that mitigation minimal, create the retrospective
issue and roadmap entry immediately, and do not merge or release until the
normal acceptance gates are restored.

## Compact patch release execution

Use the compact execution path for routine patch and compatible dependency
releases when the implementation, release, and testing-acceptance issues are
already scoped, their roadmap fields and dependencies are current, and no open
decision changes the release contract. This path reduces repeated agent work;
it never reduces repository checks or approval gates.

When the compact path applies:

1. Reuse the existing issues, milestone, parent/sub-issue relationships, and
   recorded test evidence. Do not recreate planning or repeat completed
   analysis without a concrete invalidation reason.
2. Inspect only the relevant issues, milestone, project items, pull requests,
   commits, and workflows. Query the complete roadmap or issue inventory only
   when the targeted records reveal a scope, dependency, or status conflict.
3. Request machine-readable, filtered GitHub responses. Read only the project
   fields that need verification or modification instead of loading every item
   and every field option repeatedly.
4. Poll long-running workflows at intervals of 60 to 90 seconds and report only
   their aggregate state while they are running. Retrieve job details and logs
   only for failures, anomalous delays, or the final evidence record. Avoid
   verbose watch output that repeats unchanged jobs and steps.
5. Perform one release-baseline check before publication and one final
   consistency check after publication. The final check must reconcile the
   source commit, tag, release, archive, application image digest, Helm chart,
   target channel, issue state, and outstanding manual acceptance.
6. Keep implementation completion, release publication, testing-channel
   promotion, and manual acceptance as separate states. Never close a manual
   acceptance issue based only on automated publication evidence.
7. Summarize the result in product terms first. Include the version, delivered
   behavior, source commit, published artifacts, immutable image digest,
   promoted channel, retained gates, and remaining manual checks. Issue and
   pull-request numbers are supporting references, not the explanation.

Fall back to the full planning and review workflow when any of these conditions
applies:

- planning artifacts are missing, inconsistent, stale, or blocked;
- scope, dependencies, release policy, or the target channel changed;
- the work introduces a major dependency or runtime upgrade, database
  migration, authentication or authorization change, new external interface,
  security-boundary change, or new deployment topology;
- a required gate fails, produces ambiguous evidence, or the reviewed source
  commit changes;
- a security finding requires exposure analysis or an exception;
- production or `latest` promotion is requested.

The compact path must still run every check required by the issue, release
documentation, and repository workflows. Token or time savings are never a
reason to skip, weaken, suppress, or administratively bypass a gate.

## Project structure

- `src/`: React and TypeScript frontend.
- `server/`: Fastify API, validation, routes, SQLite access, and migrations.
- `shared/`: shared API types.
- `server/migrations/`: ordered SQL migrations copied into `dist-server`.
- `scripts/`: backup, restore verification, healthcheck, build, and release
  checks.
- `docs/`: installation, deployment, security, backup, update, and data-model
  documentation.

## Required checks

Run these after relevant changes:

```bash
npm run lint
npm run test
npm run build
```

Use `npm run release:check` before a release.

## Data protection

- Never commit real names, addresses, schedules, notes, evidence references,
  court documents, screenshots, SQLite files, backups, PDFs, CSVs, or secrets.
- Use only obviously fictional demo and test data.
- Do not log request bodies or sensitive proxy identity headers.

## Change rules

- Preserve existing application functions.
- Update README and relevant docs for architecture or operating changes.
- Add a migration and update `docs/data-model.md` for schema changes.
- Update `SECURITY.md` and `docs/security.md` for security changes.
- Keep `.env.example` free of secrets and real domains.
- Always run `npm run build` before considering a change complete.
