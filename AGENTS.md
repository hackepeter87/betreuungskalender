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

## Agent collaboration

- The main agent owns planning, architecture and product decisions, ambiguous
  failures, integration, required checks, and the complete acceptance result.
- Delegate a substantial, well-bounded subtask when doing so reduces total
  work. Bundle related routine work; do not create an agent for every trivial
  step. Use deterministic formatters, codemods, or scripts first.
- Use `explorer` for read-only repository reconnaissance, `mechanic` for a
  confirmed change in explicitly assigned files, and `reviewer` for targeted
  risk-based review. Their models are fixed in `.codex/agents/`; do not rely on
  inheritance from the main model.
- Run no more than three subagents concurrently. Give each only the required
  files, constraints, expected result, and checks. Avoid full chat histories,
  repeated repository scans, and unbounded logs.
- Only the main agent delegates. Subagents must not spawn or delegate to other
  agents. Project configuration pins the V1 backend and a depth of one; the
  instruction and main-agent review remain mandatory.
- Give writing agents non-overlapping file ownership. Sequence overlapping or
  dependent work. Subagents report changed files, checks, and blockers briefly.
- After one failed attempt, decide whether a targeted retry is worthwhile.
  After two failures on the same problem, the main agent reassesses or takes
  over.
- If a configured model is unavailable, name the replacement and disclose any
  cost-class change before use. The main agent reviews and integrates every
  delegated result.

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
