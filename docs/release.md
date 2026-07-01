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
npm version X.Y.Z --no-git-tag-version
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
metadata, native OIDC deployment documentation, and the expected `v<version>`
tag. If the tag already exists, it must point to `HEAD`. The command also runs
the build, lint, and test scripts.

## 6. Commit the release preparation

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): prepare vX.Y.Z"
```

Include `docs/release-notes/vX.Y.Z.md` in the commit. Run
`npm run release:check:strict` once more after the commit. The working tree must
be clean.

## 7. Create an annotated tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

## 8. Push the commit and tag

```bash
git push
git push origin vX.Y.Z
```

Pushing a `v*` tag starts `.github/workflows/release.yml`. The workflow:

- runs `npm run release:check:strict` before packaging;
- builds and starts the production container, then checks `/api/health`;
- creates `betreuungskalender-vX.Y.Z.tar.gz` and a SHA-256 checksum;
- includes the minimal runtime `Dockerfile.release`, `deploy/compose.yml`, and
  `deploy/compose.oidc.yml`, oauth2-proxy examples, and operational
  update/verification scripts required by the supported Compose update path;
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
sha256sum --check betreuungskalender-vX.Y.Z.tar.gz.sha256
```

On macOS, compare `shasum -a 256 betreuungskalender-vX.Y.Z.tar.gz` with the
recorded checksum.

## 10. Create the GitHub release

- Use the matching tag.
- Use `docs/release-notes/vX.Y.Z.md` as the release description.
- Mark early versions as pre-releases where appropriate.
- Do not attach real exports, backups, reports, databases, or screenshots with
  personal data.
- For native OIDC releases, include the fresh-install, migration, rollback, and
  trusted-proxy transition notes in the release description.
- Publish only after the tag workflow and checksum verification pass.

Publishing a non-draft `v*` release starts
`.github/workflows/publish-release-image.yml`. That workflow re-checks the
tagged release, validates the release runtime image, publishes
`Dockerfile.release` to GitHub Container Registry, and uploads
`betreuungskalender-vX.Y.Z.image-digest.txt` to the release.

The GHCR workflow uses `GITHUB_TOKEN` with `packages: write` only in the image
publish job. It also needs `contents: write` in that job so it can attach the
image digest file to the GitHub release. Keep the general release validation
workflow read-only.

Published image tags:

- `ghcr.io/hackepeter87/betreuungskalender:vX.Y.Z`
- `ghcr.io/hackepeter87/betreuungskalender:X.Y.Z`
- `ghcr.io/hackepeter87/betreuungskalender:latest` for non-prerelease
  published releases

`latest` is a convenience tag only. Do not use it in demo or production
Compose files. Image-based deployments use explicit promotion channels:

- `testing` for the `bk-demo.saas-lab.de` demo machine;
- `production` for the production machine.

Run the **Promote testing image** workflow with the release tag after the GHCR
release image exists. Deploy and validate the demo machine, including native
OIDC login, `/api/health`, `/api/ready`, unauthenticated `401` API responses,
and persistence of synthetic demo data across the update. Only then run
**Promote production image** with the same release tag. The production promotion
fails if `testing` does not point at the same digest as the release tag.

Prefer the immutable digest reference recorded in the release asset and workflow
summaries when auditing what was promoted. See
[image-promotion.md](image-promotion.md) for the Podman Compose runtime and
promotion procedure.

## 11. Record the published-artifact smoke test

After publication, test the released archive outside the normal CI context and
record the result under `docs/release-smoke-tests/vX.Y.Z.md`. At minimum,
download the published archive and checksum, verify the SHA-256 value, inspect
the archive for prohibited data artifacts, start a clean runtime from the
archive, verify health and version reporting, create and validate a synthetic
SQLite backup, restore that backup in an isolated runtime, and run the update
tool in `--dry-run` mode where Docker Compose is available. If the GHCR image
is used, pull it by the recorded immutable digest and verify that
`npm run verify:runtime -- --expected-version X.Y.Z` reports the expected
version.

If the tag already exists, investigate before changing or deleting it. Never
silently replace a published release tag.
