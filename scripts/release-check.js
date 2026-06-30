import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_GITIGNORE_RULES = [
  ".env",
  ".env.*",
  "!.env.example",
  "!deploy/.env.oidc.example",
  "/data/",
  "/backups/",
  "/exports/",
  "/secrets/",
  "*.sqlite",
  "*.sqlite-*",
  "*.db",
  "*.db-*",
  "*.pdf",
  "*.csv",
  "betreuungskalender-backup-*.json",
  "backup-*.json"
];

const ALLOWED_PATHS = new Set([
  ".env.example",
  "deploy/.env.oidc.example",
  "scripts/backup.js",
  "scripts/release-check.js",
  "src/lib/export.ts",
  "src/components/MobileExportNotice.tsx",
  "src/pages/BackupPage.tsx"
]);

const CRITICAL_PROJECT_PATHS = [
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "docs/backup-restore.md",
  "docs/release.md",
  "server/migrations/001_initial_schema.sql",
  ".github/workflows/ci.yml",
  ".github/workflows/container.yml",
  ".github/workflows/release.yml",
  ".github/actions/validate-container/action.yml",
  ".env.example"
];

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
const SCREENSHOT_DIRECTORY = "docs/assets/screenshots/";
const PUBLIC_ICON_DIRECTORY = "public/icons/";
const IMAGE_PATTERN = /\.(?:png|jpe?g|webp)$/i;

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function classifySensitiveArtifact(filePath) {
  const normalized = normalizePath(filePath);
  const lower = normalized.toLowerCase();
  const fileName = basename(lower);

  if (ALLOWED_PATHS.has(normalized) || normalized.startsWith("docs/")) {
    return null;
  }

  if (
    fileName === ".env" ||
    (fileName.startsWith(".env.") && fileName !== ".env.example")
  ) {
    return "environment file";
  }
  if (
    lower.startsWith("data/") ||
    lower.startsWith("backups/") ||
    lower.startsWith("exports/") ||
    lower.startsWith("secrets/")
  ) {
    return "file in a local data, backup, export, or secrets directory";
  }
  if (/\.sqlite(?:$|-)/i.test(lower)) {
    return "SQLite database or sidecar file";
  }
  if (/\.db(?:$|-)/i.test(lower)) {
    return "database or sidecar file";
  }
  if (/\.pdf$/i.test(lower)) {
    return "PDF export";
  }
  if (/\.csv$/i.test(lower)) {
    return "CSV export";
  }
  if (
    /^betreuungskalender-backup-.*\.json$/i.test(fileName) ||
    /^backup-.*\.json$/i.test(fileName) ||
    /\.backup\.json$/i.test(fileName) ||
    /\.export\.json$/i.test(fileName)
  ) {
    return "JSON backup or export";
  }

  return null;
}

export function isImageOutsideScreenshotDirectory(filePath) {
  const normalized = normalizePath(filePath);
  return (
    IMAGE_PATTERN.test(normalized) &&
    !normalized.toLowerCase().startsWith(SCREENSHOT_DIRECTORY) &&
    !normalized.toLowerCase().startsWith(PUBLIC_ICON_DIRECTORY)
  );
}

export function findMissingGitignoreRules(content) {
  const rules = new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  );
  return REQUIRED_GITIGNORE_RULES.filter((rule) => !rules.has(rule));
}

export function isValidSemver(version) {
  return typeof version === "string" && SEMVER_PATTERN.test(version);
}

export function releaseTagForVersion(version) {
  return `v${version}`;
}

export function releaseNotesPathForVersion(version) {
  return `docs/release-notes/${releaseTagForVersion(version)}.md`;
}

export function hasChangelogRelease(content, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`,
    "m"
  ).test(content);
}

export function hasReleaseNotesHeading(content, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^# v${escapedVersion}(?:\\s|$)`, "m").test(content);
}

export function parseEnvValue(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^\\s*${escapedKey}=(.*)$`, "m"));
  return match ? match[1].trim() : undefined;
}

export function composePublishesAppPort(composeContent) {
  const lines = composeContent.split(/\r?\n/);
  const serviceStart = lines.findIndex((line) => line === "  betreuungskalender:");
  if (serviceStart === -1) return false;
  const serviceEnd = lines.findIndex((line, index) =>
    index > serviceStart && /^  [A-Za-z0-9_-]+:$/.test(line)
  );
  const service = lines.slice(serviceStart, serviceEnd === -1 ? undefined : serviceEnd);
  return service.some((line) => line === "    ports:");
}

function parseArguments(argv) {
  const supported = new Set(["--strict", "--build", "--lint", "--test", "--all", "--tag"]);
  const unknown = argv.filter((argument) => argument.startsWith("-") && !supported.has(argument));
  return {
    strict: argv.includes("--strict"),
    build: argv.includes("--build") || argv.includes("--all"),
    lint: argv.includes("--lint") || argv.includes("--all"),
    test: argv.includes("--test") || argv.includes("--all"),
    tag: argv.includes("--tag"),
    unknown
  };
}

function runGit(args, cwd) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false
  });
}

function runNpmScript(scriptName, cwd) {
  console.log(`\n> npm run ${scriptName}`);
  return spawnSync("npm", ["run", scriptName], {
    cwd,
    stdio: "inherit",
    shell: false
  });
}

function splitNullOutput(output = "") {
  return output.split("\0").filter(Boolean);
}

function formatArtifactList(artifacts) {
  return artifacts.map(({ path, reason }) => `  - ${path} (${reason})`);
}

function warnAboutImages(files, report) {
  for (const path of files.filter(isImageOutsideScreenshotDirectory)) {
    report.warn(
      `Image file outside ${SCREENSHOT_DIRECTORY}: ${path}`,
      ["  Please verify that it contains no personal data."]
    );
  }
}

function createReport(strict) {
  const items = [];
  return {
    pass(label, details = []) {
      items.push({ status: "PASS", label, details });
    },
    warn(label, details = [], strictFailure = false) {
      items.push({
        status: strict && strictFailure ? "FAIL" : "WARN",
        label,
        details
      });
    },
    fail(label, details = []) {
      items.push({ status: "FAIL", label, details });
    },
    hasFailures() {
      return items.some((item) => item.status === "FAIL");
    },
    print() {
      const failed = items.some((item) => item.status === "FAIL");
      console.log(`\nRelease check ${failed ? "failed" : "summary"}:`);
      for (const item of items) {
        console.log(`[${item.status}] ${item.label}`);
        for (const detail of item.details) console.log(detail);
      }
      if (failed) {
        console.log("\nResolve all [FAIL] items before creating a release.");
      }
    }
  };
}

function checkPackageVersion(packageJson, report) {
  if (!isValidSemver(packageJson.version)) {
    report.fail("package.json must contain a valid SemVer version");
    return null;
  }
  report.pass(`package.json version: ${packageJson.version}`);
  return packageJson.version;
}

function checkReleaseMetadata(cwd, packageJson, version, report) {
  if (!version) return;

  const packageLockPath = resolve(cwd, "package-lock.json");
  try {
    const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
    const lockVersions = [
      packageLock.version,
      packageLock.packages?.[""]?.version
    ].filter(Boolean);
    if (
      lockVersions.length < 2 ||
      lockVersions.some((lockVersion) => lockVersion !== packageJson.version)
    ) {
      report.fail("package-lock.json version must match package.json");
    } else {
      report.pass(`package-lock.json version: ${packageJson.version}`);
    }
  } catch {
    report.fail("package-lock.json could not be read");
  }

  const changelogPath = resolve(cwd, "CHANGELOG.md");
  try {
    const changelog = readFileSync(changelogPath, "utf8");
    if (hasChangelogRelease(changelog, version)) {
      report.pass(`CHANGELOG.md contains release ${version}`);
    } else {
      report.fail(`CHANGELOG.md is missing a dated ${version} release heading`);
    }
  } catch {
    report.fail("CHANGELOG.md could not be read");
  }

  const notesPath = releaseNotesPathForVersion(version);
  try {
    const releaseNotes = readFileSync(resolve(cwd, notesPath), "utf8");
    if (hasReleaseNotesHeading(releaseNotes, version)) {
      report.pass(`${notesPath} matches version ${version}`);
    } else {
      report.fail(`${notesPath} must start with a v${version} heading`);
    }
  } catch {
    report.fail(`${notesPath} could not be read`);
  }
}

function checkDeploymentExamples(cwd, report) {
  let envExample;
  let compose;
  try {
    envExample = readFileSync(resolve(cwd, ".env.example"), "utf8");
    compose = readFileSync(resolve(cwd, "deploy", "compose.yml"), "utf8");
  } catch {
    report.fail("release deployment examples could not be read");
    return;
  }

  const trustProxyAuth = parseEnvValue(envExample, "TRUST_PROXY_AUTH");
  if (composePublishesAppPort(compose) && trustProxyAuth === "true") {
    report.fail(
      ".env.example must not enable trusted proxy auth for directly published compose.yml",
      [
        "  - deploy/compose.yml publishes the app service with ports:",
        "  - TRUST_PROXY_AUTH=true may only be used when direct app access is blocked by a trusted proxy topology.",
        "  - Keep TRUST_PROXY_AUTH=true in deploy/.env.oidc.example, where only oauth2-proxy publishes a host port."
      ]
    );
    return;
  }
  report.pass("direct Compose example does not trust proxy identity headers");
}

function checkGitRepository(cwd, options, report) {
  const repository = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  if (repository.status !== 0 || (repository.stdout ?? "").trim() !== "true") {
    report.warn(
      "Git repository checks unavailable",
      ["  - Run the check from inside the release repository."],
      true
    );
    return false;
  }

  const status = runGit(["status", "--porcelain", "--untracked-files=normal"], cwd);
  if (status.status !== 0) {
    report.fail("git status --porcelain failed");
  } else if ((status.stdout ?? "").trim()) {
    report.warn(
      "working tree has uncommitted changes",
      (status.stdout ?? "")
        .trimEnd()
        .split(/\r?\n/)
        .map((line) => `  ${line}`),
      true
    );
  } else {
    report.pass("working tree is clean");
  }

  const trackedResult = runGit(["ls-files", "-z"], cwd);
  if (trackedResult.status !== 0) {
    report.fail("tracked files could not be inspected");
  } else {
    const trackedFiles = splitNullOutput(trackedResult.stdout ?? "");
    const trackedArtifacts = trackedFiles
      .map((path) => ({ path, reason: classifySensitiveArtifact(path) }))
      .filter((artifact) => artifact.reason);
    if (trackedArtifacts.length) {
      report.fail(
        "tracked sensitive artifacts found",
        formatArtifactList(trackedArtifacts)
      );
    } else {
      report.pass("no tracked sensitive artifacts found");
    }
    warnAboutImages(trackedFiles, report);
  }

  const untrackedResult = runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  if (untrackedResult.status !== 0) {
    report.fail("untracked files could not be inspected");
  } else {
    const untrackedFiles = splitNullOutput(untrackedResult.stdout ?? "");
    const untrackedArtifacts = untrackedFiles
      .map((path) => ({ path, reason: classifySensitiveArtifact(path) }))
      .filter((artifact) => artifact.reason);
    if (untrackedArtifacts.length) {
      report.warn(
        "untracked sensitive artifacts found",
        formatArtifactList(untrackedArtifacts),
        true
      );
    } else {
      report.pass("no untracked sensitive artifacts found");
    }
    warnAboutImages(untrackedFiles, report);
  }

  if (options.tag) {
    checkReleaseTag(cwd, options.version, report);
  }

  return true;
}

function checkReleaseTag(cwd, version, report) {
  if (!version) {
    report.fail("release tag cannot be checked without a valid version");
    return;
  }
  const expectedTag = releaseTagForVersion(version);
  const tagResult = runGit(
    ["rev-parse", "--verify", `refs/tags/${expectedTag}^{commit}`],
    cwd
  );
  if (tagResult.status !== 0) {
    report.pass(`release tag ${expectedTag} is available`);
    return;
  }

  const headResult = runGit(["rev-parse", "HEAD"], cwd);
  if (headResult.status !== 0) {
    report.fail(`release tag ${expectedTag} could not be checked`);
  } else if (
    (tagResult.stdout ?? "").trim() === (headResult.stdout ?? "").trim()
  ) {
    report.pass(`release tag ${expectedTag} points to HEAD`);
  } else {
    report.fail(`release tag ${expectedTag} does not point to HEAD`);
  }
}

function checkGitignore(cwd, hasGitRepository, report) {
  const gitignorePath = resolve(cwd, ".gitignore");
  if (!existsSync(gitignorePath)) {
    report.warn(".gitignore is missing", [], true);
    return;
  }

  const missingRules = findMissingGitignoreRules(readFileSync(gitignorePath, "utf8"));
  if (missingRules.length) {
    report.warn(
      ".gitignore is missing required safety rules",
      missingRules.map((rule) => `  - ${rule}`),
      true
    );
  } else {
    report.pass(".gitignore contains required safety rules");
  }

  if (!hasGitRepository) return;

  const ignoredCriticalPaths = CRITICAL_PROJECT_PATHS.filter((path) => existsSync(resolve(cwd, path)))
    .filter((path) => runGit(["check-ignore", "--no-index", "-q", "--", path], cwd).status === 0);

  if (ignoredCriticalPaths.length) {
    report.warn(
      "critical project files are ignored",
      ignoredCriticalPaths.map((path) => `  - ${path}`),
      true
    );
  } else {
    report.pass("critical project files are not ignored");
  }
}

function runOptionalChecks(cwd, packageJson, options, report) {
  const requested = [
    ["build", options.build],
    ["lint", options.lint],
    ["test", options.test]
  ];

  for (const [scriptName, enabled] of requested) {
    if (!enabled) continue;
    if (!packageJson.scripts?.[scriptName]) {
      report.warn(`${scriptName} script is not defined; check skipped`);
      continue;
    }
    const result = runNpmScript(scriptName, cwd);
    if (result.status === 0) {
      report.pass(`${scriptName} passed`);
    } else {
      report.fail(`${scriptName} failed`);
    }
  }
}

export function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const options = parseArguments(argv);
  const report = createReport(options.strict);

  if (options.unknown.length) {
    report.fail(
      "unknown command-line flags",
      options.unknown.map((argument) => `  - ${argument}`)
    );
  }

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  } catch {
    report.fail("package.json could not be read");
    report.print();
    return 1;
  }

  options.version = checkPackageVersion(packageJson, report);
  checkReleaseMetadata(cwd, packageJson, options.version, report);
  checkDeploymentExamples(cwd, report);
  const hasGitRepository = checkGitRepository(cwd, options, report);
  checkGitignore(cwd, hasGitRepository, report);

  if (!report.hasFailures()) {
    runOptionalChecks(cwd, packageJson, options, report);
  } else if (options.build || options.lint || options.test) {
    report.warn("build, lint, and test checks skipped because safety checks failed");
  }

  report.print();
  return report.hasFailures() ? 1 : 0;
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  process.exitCode = main();
}
