import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync
} from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface LockPackage {
  name?: string;
  version?: string;
  license?: string;
  resolved?: string;
  integrity?: string;
  dev?: boolean;
  optional?: boolean;
}

export interface PackageLock {
  name: string;
  version: string;
  lockfileVersion: number;
  packages: Record<string, LockPackage>;
}

export interface LicensePolicy {
  schemaVersion: number;
  approvedLicenses: string[];
  browserPackages: string[];
  reviewedComponents: Record<string, {
    license: string;
    reason: string;
  }>;
}

interface AssetReview {
  name: string;
  path: string;
  license: string;
  source: string;
  distributionScope: string;
}

interface InventoryComponent {
  name: string;
  version: string;
  license: string;
  distributionScope: string[];
  policyStatus: "approved" | "reviewed";
  packagePath: string;
  resolved?: string;
  integrity?: string;
  optional: boolean;
  reviewReason?: string;
}

interface CycloneDxComponent {
  group?: string;
  name?: string;
  version?: string;
  purl?: string;
}

interface CycloneDxDocument {
  components?: CycloneDxComponent[];
}

export interface LicenseInventory {
  schemaVersion: number;
  source: {
    packageLockName: string;
    packageLockVersion: string;
    lockfileVersion: number;
  };
  components: InventoryComponent[];
  assets: AssetReview[];
}

function packageNameFromPath(packagePath: string) {
  const marker = "node_modules/";
  const markerIndex = packagePath.lastIndexOf(marker);
  return markerIndex >= 0 ? packagePath.slice(markerIndex + marker.length) : basename(packagePath);
}

function componentKey(name: string, version: string) {
  return `${name}@${version}`;
}

function cycloneDxNpmKey(component: CycloneDxComponent) {
  if (component.purl?.startsWith("pkg:npm/")) {
    const withoutQualifier = component.purl.slice("pkg:npm/".length).split(/[?#]/, 1)[0];
    const versionSeparator = withoutQualifier.lastIndexOf("@");
    if (versionSeparator > 0) {
      return componentKey(
        decodeURIComponent(withoutQualifier.slice(0, versionSeparator)),
        decodeURIComponent(withoutQualifier.slice(versionSeparator + 1))
      );
    }
  }
  if (!component.name || !component.version) return undefined;
  const name = component.group
    ? `${component.group}/${component.name}`
    : component.name;
  return componentKey(name, component.version);
}

export function verifyRuntimeInventoryInImage(
  inventory: LicenseInventory,
  imageSbom: CycloneDxDocument
) {
  const imageComponents = new Set(
    (imageSbom.components ?? [])
      .map(cycloneDxNpmKey)
      .filter((key): key is string => Boolean(key))
  );
  const missing = inventory.components
    .filter(({ distributionScope, optional }) =>
      distributionScope.includes("runtime-image") && !optional
    )
    .map(({ name, version }) => componentKey(name, version))
    .filter((key) => !imageComponents.has(key));
  if (missing.length) {
    throw new Error(`runtime components missing from image SBOM: ${missing.join(", ")}`);
  }
}

export function buildLicenseInventory(
  packageLock: PackageLock,
  policy: LicensePolicy,
  assets: AssetReview[]
): LicenseInventory {
  if (policy.schemaVersion !== 1) {
    throw new Error(`unsupported license policy schema ${policy.schemaVersion}`);
  }
  const approved = new Set(policy.approvedLicenses);
  const browserPackages = new Set(policy.browserPackages);
  const components = Object.entries(packageLock.packages)
    .filter(([packagePath]) => packagePath !== "")
    .map(([packagePath, metadata]) => {
      const name = packageNameFromPath(packagePath);
      const version = metadata.version;
      const license = metadata.license?.trim();
      if (!version) {
        throw new Error(`${name}: missing resolved version`);
      }
      if (!license) {
        throw new Error(`${componentKey(name, version)}: missing license metadata`);
      }

      const key = componentKey(name, version);
      const review = policy.reviewedComponents[key];
      if (!approved.has(license) && (!review || review.license !== license || !review.reason.trim())) {
        throw new Error(`${key}: unresolved license ${license}`);
      }

      const distributionScope = metadata.dev
        ? ["build-only"]
        : browserPackages.has(name)
          ? ["browser-bundle", "runtime-image"]
          : ["runtime-image"];

      return {
        name,
        version,
        license,
        distributionScope,
        policyStatus: review ? "reviewed" as const : "approved" as const,
        packagePath,
        ...(metadata.resolved ? { resolved: metadata.resolved } : {}),
        ...(metadata.integrity ? { integrity: metadata.integrity } : {}),
        optional: Boolean(metadata.optional),
        ...(review ? { reviewReason: review.reason } : {})
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
    );

  const knownKeys = new Set(components.map(({ name, version }) => componentKey(name, version)));
  const staleReviews = Object.keys(policy.reviewedComponents).filter((key) => !knownKeys.has(key));
  if (staleReviews.length) {
    throw new Error(`stale reviewed components: ${staleReviews.join(", ")}`);
  }

  return {
    schemaVersion: 1,
    source: {
      packageLockName: packageLock.name,
      packageLockVersion: packageLock.version,
      lockfileVersion: packageLock.lockfileVersion
    },
    components,
    assets: [...assets].sort((left, right) => left.path.localeCompare(right.path))
  };
}

function normalizeAuthor(author: unknown): string | undefined {
  if (typeof author === "string" && author.trim()) return author.trim();
  if (author && typeof author === "object" && "name" in author && typeof author.name === "string") {
    return author.name.trim() || undefined;
  }
  return undefined;
}

const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

async function noticeTextForPackage(root: string, component: InventoryComponent) {
  const packageDirectory = resolve(root, component.packagePath);
  const files = await readdir(packageDirectory);
  const noticeFiles = files
    .filter((file) => /^(licen[cs]e|copying|notice|copyright|feel-free)(\..*)?$/i.test(file))
    .sort((left, right) => left.localeCompare(right));
  if (noticeFiles.length) {
    const sections = await Promise.all(noticeFiles.map(async (file) => {
      const content = await readFile(resolve(packageDirectory, file), "utf8");
      return `Source file: ${file}\n\n${content.trim()}`;
    }));
    return sections.join("\n\n---\n\n");
  }

  if (component.license !== "MIT") {
    throw new Error(`${componentKey(component.name, component.version)}: no license or notice file found`);
  }
  const packageJson = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8")) as {
    author?: unknown;
  };
  const author = normalizeAuthor(packageJson.author);
  if (!author) {
    throw new Error(`${componentKey(component.name, component.version)}: MIT fallback lacks author metadata`);
  }
  return `Copyright holder metadata: ${author}\n\n${MIT_TERMS}`;
}

export async function generateThirdPartyNotices(
  root: string,
  packageLock: PackageLock,
  inventory: LicenseInventory
) {
  const runtimeComponents = inventory.components.filter(({ distributionScope }) =>
    distributionScope.includes("runtime-image")
  );
  const groupedNotices = new Map<string, { text: string; components: string[] }>();

  for (const component of runtimeComponents) {
    const text = await noticeTextForPackage(root, component);
    const hash = createHash("sha256").update(text).digest("hex");
    const existing = groupedNotices.get(hash);
    if (existing) {
      existing.components.push(componentKey(component.name, component.version));
    } else {
      groupedNotices.set(hash, {
        text,
        components: [componentKey(component.name, component.version)]
      });
    }
  }

  const lines = [
    "# Third-party software notices",
    "",
    `Generated from package-lock.json for ${packageLock.name}@${packageLock.version}.`,
    "This inventory records declared metadata and reviewed notices; it is not legal advice.",
    "",
    "## Distributed npm components",
    "",
    "| Component | License | Scope | Policy |",
    "| --- | --- | --- | --- |",
    ...runtimeComponents.map((component) =>
      `| ${componentKey(component.name, component.version)} | ${component.license} | ${component.distributionScope.join(", ")} | ${component.policyStatus} |`
    ),
    "",
    "## Embedded assets",
    "",
    "| Asset | License | Scope | Source |",
    "| --- | --- | --- | --- |",
    ...inventory.assets.map((asset) =>
      `| ${asset.name} | ${asset.license} | ${asset.distributionScope} | ${asset.source} |`
    ),
    "",
    "## License and notice texts",
    ""
  ];

  for (const group of [...groupedNotices.values()].sort((left, right) =>
    left.components[0].localeCompare(right.components[0])
  )) {
    lines.push(`### ${group.components.sort().join(", ")}`, "", "```text", group.text, "```", "");
  }

  return `${lines.join("\n").trim()}\n`;
}

function normalizeCycloneDx(raw: string) {
  const sbom = JSON.parse(raw) as {
    serialNumber?: string;
    metadata?: { timestamp?: string };
    components?: Array<{ name?: string; version?: string; purl?: string }>;
  };
  delete sbom.serialNumber;
  if (sbom.metadata) delete sbom.metadata.timestamp;
  sbom.components?.sort((left, right) =>
    (left.purl ?? `${left.name}@${left.version}`).localeCompare(
      right.purl ?? `${right.name}@${right.version}`
    )
  );
  return sbom;
}

function validateAssets(root: string, assets: AssetReview[]) {
  for (const asset of assets) {
    if (!asset.name.trim() || !asset.license.trim() || !asset.source.trim() || !asset.distributionScope.trim()) {
      throw new Error(`${asset.path}: incomplete asset review`);
    }
    if (!existsSync(resolve(root, asset.path))) {
      throw new Error(`${asset.path}: reviewed asset path does not exist`);
    }
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export async function runLicenseInventory({
  root,
  outputDirectory
}: {
  root: string;
  outputDirectory?: string;
}) {
  const packageLock = readJson<PackageLock>(resolve(root, "package-lock.json"));
  const policy = readJson<LicensePolicy>(resolve(root, "compliance/license-policy.json"));
  const assets = readJson<AssetReview[]>(resolve(root, "compliance/assets.json"));
  validateAssets(root, assets);
  const inventory = buildLicenseInventory(packageLock, policy, assets);

  if (!outputDirectory) {
    return inventory;
  }

  const absoluteOutput = resolve(root, outputDirectory);
  await mkdir(absoluteOutput, { recursive: true });
  await writeFile(
    resolve(absoluteOutput, "npm-license-inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`
  );
  await writeFile(
    resolve(absoluteOutput, "THIRD_PARTY_NOTICES.md"),
    await generateThirdPartyNotices(root, packageLock, inventory)
  );

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const rawSbom = execFileSync(
    npmCommand,
    ["sbom", "--omit=dev", "--sbom-format=cyclonedx"],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  await writeFile(
    resolve(absoluteOutput, "npm.cyclonedx.json"),
    `${JSON.stringify(normalizeCycloneDx(rawSbom), null, 2)}\n`
  );
  return inventory;
}

const isDirectExecution = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  const outputIndex = process.argv.indexOf("--output-dir");
  const outputDirectory = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  const imageSbomIndex = process.argv.indexOf("--image-sbom");
  const imageSbomPath = imageSbomIndex >= 0 ? process.argv[imageSbomIndex + 1] : undefined;
  if (outputIndex >= 0 && !outputDirectory) {
    throw new Error("--output-dir requires a path");
  }
  if (imageSbomIndex >= 0 && !imageSbomPath) {
    throw new Error("--image-sbom requires a path");
  }
  const root = process.cwd();
  const inventory = await runLicenseInventory({ root, ...(outputDirectory ? { outputDirectory } : {}) });
  if (imageSbomPath) {
    verifyRuntimeInventoryInImage(
      inventory,
      readJson<CycloneDxDocument>(resolve(root, imageSbomPath))
    );
  }
  const runtimeCount = inventory.components.filter(({ distributionScope }) =>
    distributionScope.includes("runtime-image")
  ).length;
  const buildCount = inventory.components.length - runtimeCount;
  console.log(`License inventory valid: ${runtimeCount} runtime, ${buildCount} build-only, ${inventory.assets.length} asset groups.`);
}
