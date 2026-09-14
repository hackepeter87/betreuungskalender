import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { isUnknownRecord } from "../shared/objects.js";

const root = process.cwd();

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function externalActionReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(externalActionReferences);
  if (!isUnknownRecord(value)) return [];
  const current = typeof value.uses === "string" ? [value.uses] : [];
  return [...current, ...Object.values(value).flatMap(externalActionReferences)];
}

test("Dependabot covers maintained dependency ecosystems on a bounded schedule", async () => {
  const config: unknown = parse(await read(".github/dependabot.yml"));
  assert.ok(isUnknownRecord(config));
  assert.equal(config.version, 2);
  assert.ok(Array.isArray(config.updates));

  const updates = config.updates.filter(isUnknownRecord);
  assert.deepEqual(
    updates.map((update) => update["package-ecosystem"]).sort(),
    ["docker", "github-actions", "npm"]
  );
  for (const update of updates) {
    assert.equal(update.directory, "/");
    assert.ok(isUnknownRecord(update.schedule));
    assert.equal(update.schedule.interval, "weekly");
    assert.equal(update.schedule.timezone, "Europe/Berlin");
    assert.ok(
      typeof update["open-pull-requests-limit"] === "number" &&
      update["open-pull-requests-limit"] <= 6
    );
  }

  const npm = updates.find((update) => update["package-ecosystem"] === "npm");
  assert.ok(npm && isUnknownRecord(npm.groups));
  const production = npm.groups["routine-production"];
  assert.ok(isUnknownRecord(production) && Array.isArray(production["exclude-patterns"]));
  for (const dependency of ["fastify", "openid-client", "better-sqlite3", "pg", "ical.js"]) {
    assert.ok(production["exclude-patterns"].includes(dependency));
  }
});

test("external workflow actions use immutable commit references", async () => {
  const workflowDirectory = path.join(root, ".github/workflows");
  const workflowFiles = (await readdir(workflowDirectory))
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
  const invalid: string[] = [];

  for (const file of workflowFiles) {
    const workflow: unknown = parse(await read(path.posix.join(".github/workflows", file)));
    for (const reference of externalActionReferences(workflow)) {
      if (reference.startsWith("./")) continue;
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$/u.test(reference)) {
        invalid.push(`${file}: ${reference}`);
      }
    }
  }

  assert.deepEqual(invalid, []);
});

test("container build stages and promotions use immutable image references", async () => {
  for (const dockerfile of ["Dockerfile", "Dockerfile.release"]) {
    const externalImages = (await read(dockerfile))
      .split(/\r?\n/u)
      .map((line) => /^FROM\s+(\S+)/u.exec(line)?.[1])
      .filter((image): image is string => Boolean(image) && image !== "build" && image !== "production-deps");
    assert.ok(externalImages.length > 0);
    for (const image of externalImages) {
      assert.match(image, /@sha256:[0-9a-f]{64}$/u, `${dockerfile}: ${image}`);
    }
  }

  const testingPromotion = await read(".github/workflows/promote-testing.yml");
  assert.match(testingPromotion, /imagetools create[^\n]+"\$immutable_source"/u);
  const productionPromotion = await read(".github/workflows/promote-production.yml");
  assert.match(productionPromotion, /"\$\{\{ steps\.verify\.outputs\.immutable_ref \}\}"/u);
});
