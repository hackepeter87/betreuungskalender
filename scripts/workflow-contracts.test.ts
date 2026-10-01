import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { isUnknownRecord } from "../shared/objects.js";

const root = process.cwd();

async function workflow(name: string): Promise<Record<string, unknown>> {
  const parsed: unknown = parse(
    await readFile(path.join(root, ".github/workflows", name), "utf8")
  );
  assert.ok(isUnknownRecord(parsed), `${name} must contain a workflow object`);
  return parsed;
}

function record(value: unknown, message: string): Record<string, unknown> {
  assert.ok(isUnknownRecord(value), message);
  return value;
}

function list(value: unknown, message: string): unknown[] {
  assert.ok(Array.isArray(value), message);
  return value;
}

function trigger(config: Record<string, unknown>, name: string): Record<string, unknown> {
  const triggers = record(config.on, "workflow must define triggers");
  return record(triggers[name], `workflow must define ${name}`);
}

test("supersedable pull request workflows cancel stale runs", async () => {
  for (const name of ["ci.yml", "container.yml", "dependency-review.yml", "trivy.yml"]) {
    const config = await workflow(name);
    const concurrency = record(config.concurrency, `${name} must define concurrency`);
    assert.equal(concurrency["cancel-in-progress"], true, name);
    assert.match(String(concurrency.group), /pull_request\.number/u, name);
  }
});

test("release and promotion workflows serialize without cancelling an active publication", async () => {
  for (const name of [
    "release.yml",
    "publish-release-image.yml",
    "publish-release-chart.yml",
    "promote-testing.yml",
    "promote-production.yml"
  ]) {
    const config = await workflow(name);
    const concurrency = record(config.concurrency, `${name} must define concurrency`);
    assert.equal(concurrency["cancel-in-progress"], false, name);
    assert.ok(String(concurrency.group).length > 0, name);
  }
});

test("container push validation runs only after merge while pull requests remain covered", async () => {
  const config = await workflow("container.yml");
  assert.deepEqual(trigger(config, "push").branches, ["main"]);
  const containerPaths = list(
    trigger(config, "pull_request").paths,
    "container pull_request paths are required"
  );
  assert.ok(containerPaths.includes("Dockerfile.release"));
  assert.ok(containerPaths.includes("tsconfig*.json"));

  const jobs = record(config.jobs, "container jobs are required");
  for (const name of ["validate-release-runtime", "validate-postgres-compose-runtime"]) {
    const job = record(jobs[name], `${name} is required`);
    assert.equal(job.needs, "validate");
    assert.match(String(job.if), /needs\.validate\.outputs/u);
  }
});

test("CI keeps a stable aggregate gate and starts expensive jobs after validation", async () => {
  const config = await workflow("ci.yml");
  const jobs = record(config.jobs, "CI jobs are required");
  const validation = record(jobs.validation, "Validation job is required");
  const required = record(jobs["required-gates"], "Required quality gates job is required");
  assert.equal(validation.name, "Validation");
  assert.equal(required.name, "Required quality gates");

  for (const name of ["postgres-runtime", "e2e", "security-runtime", "helm", "update-workflow"]) {
    const job = record(jobs[name], `${name} is required`);
    assert.equal(job.needs, "validation", `${name} must wait for fast validation`);
    assert.match(String(job.if), /needs\.validation\.outputs/u, name);
  }

  const e2e = record(jobs.e2e, "E2E job is required");
  const serialized = JSON.stringify(e2e);
  assert.match(serialized, /actions\/download-artifact@/u);
  assert.doesNotMatch(serialized, /npm run build/u);

  const validationSteps = list(validation.steps, "Validation steps are required");
  const uploadStep = validationSteps
    .map((step) => record(step, "Validation steps must be objects"))
    .find((step) => String(step.uses).startsWith("actions/upload-artifact@"));
  assert.ok(uploadStep, "Validation must upload the application build");
  assert.equal(
    record(uploadStep.with, "Build artifact settings are required")["include-hidden-files"],
    true,
    "Vite's dist/.vite/manifest.json must be included in the shared build artifact"
  );

  const postgres = record(jobs["postgres-runtime"], "PostgreSQL job is required");
  assert.match(JSON.stringify(postgres), /\[16,18\]/u);
  assert.match(JSON.stringify(postgres), /\[18\]/u);
});

test("path filters retain fail-closed scheduled and release security coverage", async () => {
  const trivy = await workflow("trivy.yml");
  assert.ok(list(trigger(trivy, "push").paths, "Trivy push paths are required").includes("package-lock.json"));
  const trivyPullRequestPaths = list(trigger(trivy, "pull_request").paths, "Trivy PR paths are required");
  assert.ok(trivyPullRequestPaths.includes("Dockerfile.release"));
  assert.ok(trivyPullRequestPaths.includes("vite.config.*"));
  const triggers = record(trivy.on, "Trivy triggers are required");
  assert.ok(Array.isArray(triggers.schedule) && triggers.schedule.length > 0);

  const dependencyReview = await workflow("dependency-review.yml");
  const dependencyPaths = list(
    trigger(dependencyReview, "pull_request").paths,
    "dependency review paths are required"
  );
  assert.ok(dependencyPaths.includes("package-lock.json"));
  assert.ok(dependencyPaths.includes(".github/workflows/**"));

  const release = await workflow("release.yml");
  assert.deepEqual(trigger(release, "push").tags, ["v*"]);
});
