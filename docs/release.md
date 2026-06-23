# Release workflow

Run releases only from a clean checkout without local databases, exports,
backups, reports, or environment files staged for commit.

## 1. Check the working tree

```bash
git status
```

## 2. Install exact dependencies

```bash
npm ci
```

GitHub Actions uses Node.js 22.x and follows the same non-interactive sequence:
`npm ci`, `npm run release:check`, and `npm run build`. The frontend is built
with Vite through the package script; Webpack is not part of the build.

## 3. Set the version

Use the intended SemVer version before the strict check so that the expected
tag can be verified:

```bash
npm version 0.1.0 --no-git-tag-version
```

## 4. Update the changelog

Document user-visible changes and any migration or operational notes in
`CHANGELOG.md` under a dated `## [X.Y.Z] - YYYY-MM-DD` heading. Add the full
release notes at `docs/release-notes/vX.Y.Z.md`; the first heading must identify
the matching `vX.Y.Z` tag.

## 5. Run the release checks

```bash
npm run build
npm run release:check:strict
```

The strict release check verifies the Git state, sensitive artifact patterns,
`.gitignore`, matching package and lockfile versions, changelog and release-note
metadata, and the expected `v<version>` tag. If the tag already exists, it must
point to `HEAD`. The command also runs the build, lint, and test scripts.

## 6. Commit the release preparation

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: prepare v0.1.0 release"
```

Include `docs/release-notes/v0.1.0.md` in the commit. Run
`npm run release:check:strict` once more after the commit. The working tree must
be clean.

## 7. Create an annotated tag

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
```

## 8. Push the commit and tag

```bash
git push
git push origin v0.1.0
```

Pushing a `v*` tag starts `.github/workflows/release.yml`. The workflow:

- runs `npm run release:check:strict` before packaging;
- builds and starts the production container, then checks `/api/health`;
- creates `betreuungskalender-vX.Y.Z.tar.gz` and a SHA-256 checksum;
- includes the minimal runtime `Dockerfile.release`, `deploy/compose.yml`, and
  operational update/verification scripts required by the supported Compose
  update path;
- confirms that `docs/release-notes/vX.Y.Z.md` is present in the archive; and
- stores the archive, checksum, and release notes as GitHub Actions artifacts
  for 14 days.

The workflow does not create or publish a GitHub release and does not push a
container image. It requires only the repository's standard read token.

## 9. Verify the workflow

Open the tag workflow run and confirm that strict validation, container health,
archive validation, and artifact upload succeeded. Download the archive and
verify its checksum before using it:

```bash
sha256sum --check betreuungskalender-v0.1.0.tar.gz.sha256
```

On macOS, compare `shasum -a 256 betreuungskalender-v0.1.0.tar.gz` with the
recorded checksum.

## 10. Create the GitHub release

- Use the matching tag.
- Use `docs/release-notes/vX.Y.Z.md` as the release description.
- Mark early versions as pre-releases where appropriate.
- Do not attach real exports, backups, reports, databases, or screenshots with
  personal data.
- Publish only after the tag workflow and checksum verification pass.

## Optional GHCR publication

Container publication is intentionally not enabled by default. If maintainers
later add GitHub Container Registry publishing, keep it in a separate,
reviewed workflow that:

- runs only after the same strict and container validation succeeds;
- grants `packages: write` only to the publishing job;
- uses `ghcr.io/<owner>/betreuungskalender:vX.Y.Z` and an immutable digest;
- never embeds application secrets or production data in the image; and
- records the image digest in the GitHub release.

If the tag already exists, investigate before changing or deleting it. Never
silently replace a published release tag.
