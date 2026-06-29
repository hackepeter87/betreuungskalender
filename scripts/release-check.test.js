import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_GITIGNORE_RULES,
  classifySensitiveArtifact,
  findMissingGitignoreRules,
  hasChangelogRelease,
  hasReleaseNotesHeading,
  isImageOutsideScreenshotDirectory,
  isValidSemver,
  releaseNotesPathForVersion,
  releaseTagForVersion
} from "./release-check.js";

test("allows source and documentation files whose names mention backup or export", () => {
  const allowed = [
    ".env.example",
    "deploy/.env.oidc.example",
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
  const suspicious = [
    "dashboard.png",
    "public/private-calendar.jpg",
    "exports/scan.jpeg",
    "tmp/report.webp"
  ];

  for (const path of allowed) {
    assert.equal(isImageOutsideScreenshotDirectory(path), false, path);
  }
  for (const path of suspicious) {
    assert.equal(isImageOutsideScreenshotDirectory(path), true, path);
  }
  assert.equal(isImageOutsideScreenshotDirectory("public/icons/app-icon.svg"), false);
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
