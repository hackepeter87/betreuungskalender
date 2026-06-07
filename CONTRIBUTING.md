# Contributing

Thank you for helping improve Betreuungskalender. Contributions should preserve
the application's neutral documentation purpose and protect sensitive family
data.

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

## Pull requests

Explain the user-visible behavior, migration impact, tests performed, and
documentation changes. Existing features must not be removed without prior
discussion.
