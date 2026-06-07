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
`CHANGELOG.md`.

## 5. Run the release checks

```bash
npm run build
npm run release:check:strict
```

The strict release check verifies the Git state, sensitive artifact patterns,
`.gitignore`, package version, and expected `v<version>` tag. It also runs the
build, lint, and test scripts.

## 6. Commit the release preparation

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: prepare v0.1.0 release"
```

Run `npm run release:check:strict` once more after the commit. The working tree
must be clean.

## 7. Create an annotated tag

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
```

## 8. Push the commit and tag

```bash
git push
git push origin v0.1.0
```

## 9. Create the GitHub release

- Use the matching tag.
- Copy the release notes from `CHANGELOG.md`.
- Mark early versions as pre-releases where appropriate.
- Do not attach real exports, backups, reports, databases, or screenshots with
  personal data.

If the tag already exists, investigate before changing or deleting it. Never
silently replace a published release tag.
