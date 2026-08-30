# Contributing

Thank you for helping improve Betreuungskalender. Contributions should preserve
the application's neutral documentation purpose and protect sensitive family
data.

## Issue-first workflow

Repository changes start with GitHub planning, including small fixes and
documentation updates. Before creating a branch or editing files:

1. Review the private roadmap, open issues, active milestones, and related
   release work. Reuse an existing issue when its scope matches.
2. Create or update a public issue with a neutral description of the goal,
   scope, exclusions, acceptance criteria, required tests, documentation impact,
   and release constraints.
3. Assign the milestone and complete the private project fields for status,
   priority, type, area, target release, risk, and decision needs.
4. Record dependencies with parent/sub-issue links. Versioned work also needs a
   separate release and testing-acceptance issue.
5. Create a dedicated branch from current `main` only after the planning package
   is complete, then move the issue to `In Progress`.

If GitHub or project access is unavailable, stop before editing and restore
access first. Do not replace the planning package with an untracked local patch.

Open pull requests as drafts and link the issue, milestone, completed checks,
and outstanding manual acceptance. Move work to `In Review` only when it is
reviewable. Versioning, release artifacts, and testing-channel promotion remain
in the separate release issue. Updating `production` or `latest` always
requires separate explicit approval.

An active incident may use a minimal immediate mitigation only when explicitly
requested. Create the retrospective issue and roadmap entry immediately, and
restore the normal review and release gates before merge or publication.

## Development setup

Requirements: a current Node.js LTS release, npm, and build tools supported by
`better-sqlite3`.

```bash
npm ci
cp .env.example .env
# For local development, set REQUIRE_AUTH=false and use local paths.
npm run dev
```

Before opening a pull request:

```bash
npm run lint
npm run test
npm run build
```

## Branches and commits

- Use short branches such as `feat/calendar-filter`, `fix/backup-check`, or
  `docs/reverse-proxy`.
- Prefer focused commits with prefixes such as `feat:`, `fix:`, `docs:`,
  `test:`, `ci:`, or `chore:`.
- Do not combine unrelated formatting or refactoring with a behavioral change.

## Privacy rules

- Never use real children's names, addresses, schools, schedules, case
  references, court documents, screenshots, exports, or backup files.
- Do not attach SQLite databases, JSON backups, PDFs, or CSV exports to issues.
- Use obviously fictional data and places in tests and documentation.
- Redact browser screenshots before sharing them.
- Treat audit data, notes, evidence references, and proxy identity headers as
  sensitive.

## Data model and security changes

- Add a numbered migration for every persistent schema change.
- Update `docs/data-model.md` with schema changes.
- Update `SECURITY.md` and `docs/security.md` for security-relevant changes.
- Update README and deployment documentation when runtime behavior changes.

## Screenshots

Screenshots für Dokumentation oder Pull Requests dürfen keine echten
personenbezogenen Daten enthalten. Bitte ausschließlich fiktive
Demonstrationsdaten verwenden und sensible Informationen vor dem Commit
entfernen. Screenshots für die Projektdokumentation gehören nach
`docs/assets/screenshots/`.

## Pull requests

Explain the user-visible behavior, migration impact, tests performed, and
documentation changes. Existing features must not be removed without prior
discussion.
