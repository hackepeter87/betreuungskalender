import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

async function lintFixture(name: string) {
  return execFileAsync(
    process.execPath,
    ["node_modules/eslint/bin/eslint.js", "--no-ignore", `scripts/fixtures/eslint/${name}`],
    { cwd: process.cwd(), encoding: "utf8" }
  );
}

test("type-aware lint rejects unsafe external-data narrowing", async () => {
  await assert.rejects(
    lintFixture("unsafe-boundary.ts"),
    (error: unknown) => {
      assert.ok(error instanceof Error && "stdout" in error);
      assert.match(String(error.stdout), /@typescript-eslint\/no-unsafe-type-assertion/);
      return true;
    }
  );
});

test("type-aware lint accepts validated external data", async () => {
  await lintFixture("validated-boundary.ts");
});
