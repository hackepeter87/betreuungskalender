import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  REQUIRED_GITIGNORE_RULES,
  classifySensitiveArtifact,
  composePublishesAppPort,
  findMissingGitignoreRules,
  hasChangelogRelease,
  hasReleaseNotesHeading,
  isImageOutsideScreenshotDirectory,
  parseEnvValue,
  isValidSemver,
  releaseNotesPathForVersion,
  releaseTagForVersion
} from "./release-check.js";

function serviceBlock(composeContent, serviceName) {
  const lines = composeContent.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `${serviceName} service is missing`);
  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

test("allows source and documentation files whose names mention backup or export", () => {
  const allowed = [
    ".env.example",
    "deploy/.env.oidc.example",
    "deploy/app.env.demo.example",
    "docs/backup-restore.md",
    "docs/systemd/betreuungskalender-backup.service",
    "docs/systemd/betreuungskalender-backup.timer",
    "scripts/backup.js",
    "scripts/release-check.js",
    "src/lib/export.ts",
    "src/components/MobileExportNotice.tsx",
    "src/pages/BackupPage.tsx"
  ];

  for (const path of allowed) {
    assert.equal(classifySensitiveArtifact(path), null, path);
  }
});

test("detects real databases, exports, backups, and environment files", () => {
  const blocked = [
    ".env",
    ".env.local",
    "deploy/.env",
    "deploy/.env.production",
    ".env.production",
    "app.env",
    "app.env.production",
    "deploy/app.env",
    "data/app.sqlite",
    "data/app.sqlite-wal",
    "local.db",
    "local.db-shm",
    "exports/report-2026-06.pdf",
    "report.csv",
    "backups/backup.json",
    "secrets/credentials.txt",
    "betreuungskalender-backup-2026-06-07.json",
    "backup-2026-06-07.json",
    "family.backup.json",
    "care.export.json"
  ];

  for (const path of blocked) {
    assert.notEqual(classifySensitiveArtifact(path), null, path);
  }
});

test("does not classify ordinary code by generic backup or export words", () => {
  const ordinaryFiles = [
    "src/lib/exportHelpers.ts",
    "scripts/backupRotation.js",
    "src/pages/ExportPage.tsx",
    "notes/backup-plan.md"
  ];

  for (const path of ordinaryFiles) {
    assert.equal(classifySensitiveArtifact(path), null, path);
  }
});

test("allows documentation screenshots and warns about images elsewhere", () => {
  const allowed = [
    "docs/assets/screenshots/dashboard-desktop.png",
    "docs/assets/screenshots/calendar-desktop.jpg",
    "docs/assets/screenshots/entry-mobile.jpeg",
    "docs/assets/screenshots/report.webp"
  ];
  const icons = [
    "public/icons/app-icon.svg",
    "public/icons/app-icon-192.png",
    "public/icons/app-icon-512.png",
    "public/icons/apple-touch-icon.png",
    "public/icons/favicon-32.png"
  ];
  const suspicious = [
    "dashboard.png",
    "public/private-calendar.jpg",
    "exports/scan.jpeg",
    "tmp/report.webp"
  ];

  for (const path of allowed) {
    assert.equal(isImageOutsideScreenshotDirectory(path), false, path);
  }
  for (const path of icons) {
    assert.equal(isImageOutsideScreenshotDirectory(path), false, path);
  }
  for (const path of suspicious) {
    assert.equal(isImageOutsideScreenshotDirectory(path), true, path);
  }
});

test("reports exact missing gitignore safety rules", () => {
  const complete = REQUIRED_GITIGNORE_RULES.join("\n");
  assert.deepEqual(findMissingGitignoreRules(complete), []);
  assert.deepEqual(
    findMissingGitignoreRules(complete.replace("backup-*.json\n", "")),
    ["backup-*.json"]
  );
});

test("validates SemVer versions", () => {
  assert.equal(isValidSemver("0.1.0"), true);
  assert.equal(isValidSemver("1.2.3-beta.1+build.9"), true);
  assert.equal(isValidSemver("01.2.3"), false);
  assert.equal(isValidSemver("1.2"), false);
});

test("derives release tag and release notes path from the package version", () => {
  assert.equal(releaseTagForVersion("0.3.0"), "v0.3.0");
  assert.equal(
    releaseNotesPathForVersion("0.3.0"),
    "docs/release-notes/v0.3.0.md"
  );
});

test("requires dated changelog entries for the package version", () => {
  assert.equal(
    hasChangelogRelease("## [0.3.0] - 2026-06-12\n", "0.3.0"),
    true
  );
  assert.equal(
    hasChangelogRelease("## [0.3.0] - YYYY-MM-DD\n", "0.3.0"),
    false
  );
  assert.equal(
    hasChangelogRelease("## [0.2.0] - 2026-05-01\n", "0.3.0"),
    false
  );
});

test("requires release notes to identify the matching tag", () => {
  assert.equal(
    hasReleaseNotesHeading("# v0.3.0 - SQLite persistence\n", "0.3.0"),
    true
  );
  assert.equal(
    hasReleaseNotesHeading("# Release notes\n", "0.3.0"),
    false
  );
});

test("reads environment values from release examples", () => {
  assert.equal(parseEnvValue("TRUST_PROXY_AUTH=false\n", "TRUST_PROXY_AUTH"), "false");
  assert.equal(parseEnvValue("  TRUST_PROXY_AUTH=true\n", "TRUST_PROXY_AUTH"), "true");
  assert.equal(parseEnvValue("OTHER=value\n", "TRUST_PROXY_AUTH"), undefined);
});

test("detects whether direct Compose publishes the app port", () => {
  const directCompose = readFileSync(resolve("deploy", "compose.yml"), "utf8");
  const oidcCompose = readFileSync(resolve("deploy", "compose.oidc.yml"), "utf8");

  assert.equal(composePublishesAppPort(directCompose), true);
  assert.equal(composePublishesAppPort(oidcCompose), false);
});

test("direct Compose example does not trust proxy identity headers", () => {
  const envExample = readFileSync(resolve(".env.example"), "utf8");
  const directCompose = readFileSync(resolve("deploy", "compose.yml"), "utf8");
  const testingCompose = readFileSync(resolve("deploy", "compose.testing.yml"), "utf8");
  const productionCompose = readFileSync(resolve("deploy", "compose.production.yml"), "utf8");
  const imagePromotionDocs = readFileSync(resolve("docs", "image-promotion.md"), "utf8");
  const promoteTestingWorkflow = readFileSync(
    resolve(".github", "workflows", "promote-testing.yml"),
    "utf8"
  );
  const promoteProductionWorkflow = readFileSync(
    resolve(".github", "workflows", "promote-production.yml"),
    "utf8"
  );
  const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
  const releaseDockerfile = readFileSync(resolve("Dockerfile.release"), "utf8");
  const oidcEnvExample = readFileSync(resolve("deploy", ".env.oidc.example"), "utf8");
  const nativeInstallDocs = readFileSync(
    resolve("docs", "native-oidc-keycloak-podman.md"),
    "utf8"
  );
  const nativeMigrationDocs = readFileSync(
    resolve("docs", "native-oidc-migration-rollback.md"),
    "utf8"
  );

  assert.equal(composePublishesAppPort(directCompose), true);
  assert.equal(parseEnvValue(envExample, "TRUST_PROXY_AUTH"), "false");
  assert.equal(parseEnvValue(oidcEnvExample, "TRUST_PROXY_AUTH"), "true");
  assert.match(dockerfile, /FROM node:24\.18\.0-bookworm-slim AS build/);
  assert.match(dockerfile, /FROM node:24\.18\.0-bookworm-slim AS runtime/);
  assert.match(releaseDockerfile, /FROM node:24\.18\.0-bookworm-slim AS runtime/);
  assert.match(`${dockerfile}\n${releaseDockerfile}`, /npm install -g npm@11\.18\.0/);
  assert.match(`${dockerfile}\n${releaseDockerfile}`, /NPM_CONFIG_UPDATE_NOTIFIER=false/);
  assert.doesNotMatch(`${dockerfile}\n${releaseDockerfile}`, /CMD \["npm", "run", "start"\]/);
  assert.match(`${dockerfile}\n${releaseDockerfile}`, /CMD \["node", "dist-server\/server\/index\.js"\]/);
  assert.match(nativeInstallDocs, /AUTH_MODE=native-oidc/);
  assert.match(nativeInstallDocs, /TRUST_PROXY_AUTH=false/);
  assert.match(nativeInstallDocs, /OIDC_REQUIRE_ROLE_CLAIM=true/);
  assert.match(nativeInstallDocs, /https:\/\/app\.example\.net\/auth\/callback/);
  assert.match(nativeInstallDocs, /tokens, session cookies/);
  assert.match(nativeMigrationDocs, /compose\.oidc\.yml/);
  assert.match(nativeMigrationDocs, /AUTH_MODE=native-oidc/);
  assert.match(nativeMigrationDocs, /TRUST_PROXY_AUTH=false/);
  assert.match(nativeMigrationDocs, /AUTH_MODE=trusted-proxy/);
  assert.match(nativeMigrationDocs, /TRUST_PROXY_AUTH=true/);
  assert.match(nativeMigrationDocs, /rollback/i);

  assert.match(testingCompose, /ghcr\.io\/hackepeter87\/betreuungskalender:testing/);
  assert.match(productionCompose, /ghcr\.io\/hackepeter87\/betreuungskalender:production/);
  assert.doesNotMatch(`${testingCompose}\n${productionCompose}`, /APP_RELEASE_DIR|APP_RELEASE_VERSION|\n    build:/);
  assert.match(imagePromotionDocs, /deploy\/compose\.testing\.yml/);
  assert.match(imagePromotionDocs, /deploy\/compose\.production\.yml/);
  assert.match(imagePromotionDocs, /latest.*not used by deployments/s);
  assert.match(imagePromotionDocs, /bk-demo\.saas-lab\.de/);
  assert.match(promoteTestingWorkflow, /docker buildx imagetools create/);
  assert.match(promoteTestingWorkflow, /--prefer-index=false/);
  assert.match(promoteTestingWorkflow, /target_ref=.*:testing/);
  assert.match(promoteProductionWorkflow, /environment: production/);
  assert.match(promoteProductionWorkflow, /--prefer-index=false/);
  assert.match(promoteProductionWorkflow, /production_ref=.*:production/);
});

test("OIDC Compose mode keeps the app private behind oauth2-proxy", () => {
  const compose = readFileSync(resolve("deploy", "compose.oidc.yml"), "utf8");
  const proxyConfig = readFileSync(resolve("deploy", "oauth2-proxy.cfg.example"), "utf8");
  const app = serviceBlock(compose, "betreuungskalender");
  const proxy = serviceBlock(compose, "oauth2-proxy");

  assert.doesNotMatch(app, /\n    ports:\n/);
  assert.match(app, /\n    expose:\n      - "3000"/);
  assert.match(app, /\n      - \.\/data:\/data/);
  assert.match(app, /\n      - \.\/backups:\/backups/);
  assert.match(app, /\n      - oidc-private/);

  assert.match(proxy, /\n    ports:\n      - "\$\{HOST_BIND_ADDRESS:-0\.0\.0\.0\}:\$\{HOST_PORT:-8080\}:4180"/);
  assert.match(proxy, /\n      - \.\/oauth2-proxy\.cfg:\/etc\/oauth2-proxy\/oauth2-proxy\.cfg:ro/);
  assert.match(proxy, /\n      - oidc-private/);

  assert.match(proxyConfig, /upstreams = \[ "http:\/\/betreuungskalender:3000" \]/);
  assert.match(proxyConfig, /trusted_ips = \[ "127\.0\.0\.1\/32", "192\.0\.2\.10\/32" \]/);
  assert.doesNotMatch(proxyConfig, /0\.0\.0\.0\/0/);
  assert.match(proxyConfig, /client_secret = "CHANGE_ME"/);
  assert.match(proxyConfig, /cookie_secret = "CHANGE_ME_32_BYTE_BASE64"/);
});
