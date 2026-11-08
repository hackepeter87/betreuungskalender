import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildLicenseInventory,
  generateThirdPartyNotices,
  verifyRuntimeInventoryInImage,
  type LicensePolicy,
  type PackageLock
} from "./license-inventory";

const policy: LicensePolicy = {
  schemaVersion: 1,
  approvedLicenses: ["MIT", "Apache-2.0"],
  browserPackages: ["browser-lib"],
  reviewedComponents: {
    "reviewed-lib@2.0.0": {
      license: "MPL-2.0",
      reason: "Reviewed file-level reciprocal dependency."
    }
  }
};

function lock(packages: PackageLock["packages"]): PackageLock {
  return {
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture", version: "1.0.0" },
      ...packages
    }
  };
}

test("separates runtime, browser, and build-only packages deterministically", () => {
  const inventory = buildLicenseInventory(
    lock({
      "node_modules/server-lib": {
        version: "1.0.0",
        license: "MIT",
        integrity: "sha512-server"
      },
      "node_modules/browser-lib": {
        version: "1.2.0",
        license: "Apache-2.0",
        integrity: "sha512-browser"
      },
      "node_modules/build-lib": {
        version: "3.0.0",
        license: "MIT",
        integrity: "sha512-build",
        dev: true
      },
      "node_modules/reviewed-lib": {
        version: "2.0.0",
        license: "MPL-2.0",
        integrity: "sha512-reviewed"
      }
    }),
    policy,
    []
  );

  assert.deepEqual(
    inventory.components.map(({ name, distributionScope, policyStatus }) => ({
      name,
      distributionScope,
      policyStatus
    })),
    [
      { name: "browser-lib", distributionScope: ["browser-bundle", "runtime-image"], policyStatus: "approved" },
      { name: "build-lib", distributionScope: ["build-only"], policyStatus: "approved" },
      { name: "reviewed-lib", distributionScope: ["runtime-image"], policyStatus: "reviewed" },
      { name: "server-lib", distributionScope: ["runtime-image"], policyStatus: "approved" }
    ]
  );
});

test("fails closed for missing, unknown, and newly unreviewed licenses", () => {
  assert.throws(
    () => buildLicenseInventory(lock({ "node_modules/missing": { version: "1.0.0" } }), policy, []),
    /missing license metadata/
  );
  assert.throws(
    () => buildLicenseInventory(lock({
      "node_modules/custom": { version: "1.0.0", license: "LicenseRef-Custom" }
    }), policy, []),
    /unresolved license LicenseRef-Custom/
  );
  assert.throws(
    () => buildLicenseInventory(lock({
      "node_modules/new-mpl": { version: "1.0.0", license: "MPL-2.0" }
    }), policy, []),
    /unresolved license MPL-2.0/
  );
});

test("rejects stale package-specific reviews", () => {
  assert.throws(
    () => buildLicenseInventory(lock({
      "node_modules/reviewed-lib": { version: "2.1.0", license: "MPL-2.0" }
    }), policy, []),
    /unresolved license MPL-2.0/
  );
});

test("requires non-optional runtime packages in the immutable image SBOM", () => {
  const inventory = buildLicenseInventory(
    lock({
      "node_modules/runtime": { version: "1.0.0", license: "MIT" },
      "node_modules/optional": { version: "2.0.0", license: "MIT", optional: true },
      "node_modules/build": { version: "3.0.0", license: "MIT", dev: true }
    }),
    { ...policy, reviewedComponents: {} },
    []
  );

  assert.throws(
    () => verifyRuntimeInventoryInImage(inventory, { components: [] }),
    /runtime@1\.0\.0/
  );
  assert.doesNotThrow(() => verifyRuntimeInventoryInImage(inventory, {
    components: [{ purl: "pkg:npm/runtime@1.0.0" }]
  }));
});

test("generates grouped notices without duplicating identical license text", async () => {
  const root = await mkdtemp(join(tmpdir(), "license-inventory-"));
  for (const packageName of ["one", "two"]) {
    const packageDirectory = join(root, "node_modules", packageName);
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "LICENSE"), "Shared license text\n");
    await writeFile(join(packageDirectory, "package.json"), JSON.stringify({
      name: packageName,
      version: "1.0.0",
      license: "MIT",
      author: `${packageName} author`
    }));
  }
  const fixtureLock = lock({
    "node_modules/one": { version: "1.0.0", license: "MIT", integrity: "sha512-one" },
    "node_modules/two": { version: "1.0.0", license: "MIT", integrity: "sha512-two" }
  });
  const inventory = buildLicenseInventory(fixtureLock, { ...policy, reviewedComponents: {} }, []);
  const notices = await generateThirdPartyNotices(root, fixtureLock, inventory);

  assert.match(notices, /one@1\.0\.0, two@1\.0\.0/);
  assert.equal(notices.match(/Shared license text/g)?.length, 1);
});

test("keeps compliance checks and both SBOM scopes in release workflows", async () => {
  const [ci, release, imageRelease] = await Promise.all([
    readFile(".github/workflows/ci.yml", "utf8"),
    readFile(".github/workflows/release.yml", "utf8"),
    readFile(".github/workflows/publish-release-image.yml", "utf8")
  ]);

  assert.match(ci, /npm run compliance:check/);
  assert.match(release, /npm run compliance:generate/);
  assert.match(release, /artifacts\/compliance/);
  assert.match(
    imageRelease,
    /anchore\/sbom-action@66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c # v0\.24\.3/
  );
  assert.match(imageRelease, /image: \$\{\{ steps\.release\.outputs\.image \}\}@\$\{\{ steps\.build\.outputs\.digest \}\}/);
  assert.match(imageRelease, /format: cyclonedx-json/);
  assert.match(imageRelease, /npm run compliance:compare-image/);
  assert.match(imageRelease, /upload-release-assets: false/);
});
