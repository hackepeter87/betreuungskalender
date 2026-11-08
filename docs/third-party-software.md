# Third-party software and license inventory

Betreuungskalender creates a reproducible inventory from the exact npm lockfile
and from the immutable release image. The inventory supports maintenance and
license reviews; it is not a legal opinion.

## What is covered

- `npm-license-inventory.json` lists every locked production and build-only npm
  component, its resolved version, declared license, integrity value and review
  status.
- `npm.cyclonedx.json` records the installed production dependency graph in
  CycloneDX format.
- `THIRD_PARTY_NOTICES.md` groups the license and notice files distributed with
  production packages and records reviewed repository assets and fonts.
- The release-image workflow creates a separate CycloneDX SBOM from the
  immutable image digest. That file also covers operating-system packages and
  the actual runtime contents.

Runtime-image, browser-bundle and build-only scopes remain distinct. Build-only
packages are reviewed because they influence generated artifacts, but they are
not represented as runtime contents.

## Policy and review

`compliance/license-policy.json` contains a narrow set of accepted permissive
license expressions. Packages with reciprocal, dual, custom or otherwise
review-sensitive declarations need an exact package-and-version review entry.
Changing such a package version deliberately invalidates the old review.

Missing license metadata, an unknown expression, an incomplete asset record or
a stale review fails `npm run compliance:check`. Automation records metadata;
it does not decide whether a license is legally suitable for a particular
operator.

## Local commands

After `npm ci`, validate the current lockfile and assets:

```bash
npm run compliance:check
```

Generate the same npm evidence used by the release workflow:

```bash
npm run compliance:generate
```

Generated files are written to `artifacts/compliance/`, which remains ignored
outside a release run. Review a dependency update by comparing the policy,
inventory and notices. Never approve a new custom or reciprocal license merely
to make CI pass.

## Release evidence

The tag workflow includes the npm inventory, npm SBOM and notices in the source
release archive and uploads them as workflow artifacts. The image publication
workflow scans the pushed digest and attaches the image SBOM alongside the
digest evidence. Before publication continues, every non-optional runtime
component from the lockfile inventory must also occur in that image SBOM. The
two SBOMs have different purposes and must not be silently substituted for each
other.

If generation cannot run, record the missing evidence in the release issue. Do
not weaken the fail-closed policy or claim complete license evidence for that
release.
