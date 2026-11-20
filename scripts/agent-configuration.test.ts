import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

test("project subagent defaults stay bounded and economical", async () => {
  const config = await read(".codex/config.toml");
  assert.match(config, /^\[agents\]$/mu);
  assert.match(config, /^enabled = true$/mu);
  assert.match(config, /^max_concurrent_threads_per_session = 3$/mu);
  assert.match(config, /^default_subagent_model = "gpt-5\.6-luna"$/mu);
  assert.match(config, /^default_subagent_reasoning_effort = "high"$/mu);
  assert.doesNotMatch(config, /^model\s*=/mu, "the project must not override the main model");
});

test("named roles pin models and explicitly forbid further delegation", async () => {
  const roles = {
    explorer: "gpt-5.6-luna",
    mechanic: "gpt-5.6-luna",
    reviewer: "gpt-5.6-sol"
  } as const;

  for (const [role, model] of Object.entries(roles)) {
    const config = await read(`.codex/agents/${role}.toml`);
    assert.match(config, new RegExp(`^name = "${role}"$`, "mu"), role);
    assert.match(config, new RegExp(`^model = "${model.replaceAll(".", "\\.")}"$`, "mu"), role);
    assert.match(config, /^model_reasoning_effort = "high"$/mu, role);
    assert.match(config, /spawn or delegate to other agents/iu, role);
    for (const capability of [
      "apps",
      "plugins",
      "memories",
      "request_permissions_tool"
    ]) {
      assert.match(config, new RegExp(`^${capability} = false$`, "mu"), `${role}: ${capability}`);
    }
    assert.doesNotMatch(config, /^multi_agent(?:_v2)?\s*=/mu, `${role}: unsupported feature override`);
    assert.match(config, /^include_instructions = false$/mu, role);
    assert.match(config, /^enabled = false$/mu, `${role}: bundled skills`);
  }
});
