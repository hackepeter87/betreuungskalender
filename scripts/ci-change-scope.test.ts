import assert from "node:assert/strict";
import test from "node:test";
import { classifyChangedFiles } from "./ci-change-scope.mjs";

test("documentation changes do not select expensive runtime scopes", () => {
  const scope = classifyChangedFiles(["README.md", "docs/testing.md"]);
  assert.equal(scope.docs, true);
  assert.equal(scope.application, false);
  assert.equal(scope.browser, false);
  assert.equal(scope.container, false);
  assert.equal(scope.database, false);
  assert.equal(scope.image, false);
});

test("frontend changes select browser and image validation but not PostgreSQL compose", () => {
  const scope = classifyChangedFiles(["src/App.tsx", "src/styles/pages/dashboard.css"]);
  assert.equal(scope.application, true);
  assert.equal(scope.browser, true);
  assert.equal(scope.container, true);
  assert.equal(scope.image, true);
  assert.equal(scope.database, false);
  assert.equal(scope.postgres_container, false);
});

test("server changes fail closed across application, persistence, security, and container gates", () => {
  const scope = classifyChangedFiles(["server/routes/contactRules.ts"]);
  assert.equal(scope.application, true);
  assert.equal(scope.browser, true);
  assert.equal(scope.container, true);
  assert.equal(scope.database, true);
  assert.equal(scope.postgres_container, true);
  assert.equal(scope.security, true);
});

test("workflow changes select automation and dependency review without product suites", () => {
  const scope = classifyChangedFiles([".github/workflows/ci.yml"]);
  assert.equal(scope.automation, true);
  assert.equal(scope.dependencies, true);
  assert.equal(scope.application, false);
  assert.equal(scope.browser, false);
});

test("release and dependency inputs select every affected gate conservatively", () => {
  const scope = classifyChangedFiles(["package-lock.json", "charts/betreuungskalender/Chart.yaml"]);
  assert.equal(scope.application, true);
  assert.equal(scope.browser, true);
  assert.equal(scope.container, true);
  assert.equal(scope.database, true);
  assert.equal(scope.dependencies, true);
  assert.equal(scope.helm, true);
  assert.equal(scope.image, true);
  assert.equal(scope.postgres_container, true);
  assert.equal(scope.security, true);
});

test("build configuration changes select browser and container artifacts", () => {
  const scope = classifyChangedFiles(["vite.config.ts", "tsconfig.server.json", "index.html"]);
  assert.equal(scope.application, true);
  assert.equal(scope.browser, true);
  assert.equal(scope.container, true);
  assert.equal(scope.image, true);
  assert.equal(scope.postgres_container, true);
});
