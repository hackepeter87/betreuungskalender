# Agent Guidance

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
