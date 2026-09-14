import assert from "node:assert/strict";
import test from "node:test";
import { CHILD_COLORS, childColor } from "../src/data/defaults.js";

test("child colors wrap deterministically for valid indexes", () => {
  assert.equal(childColor(0), CHILD_COLORS[0]);
  assert.equal(childColor(CHILD_COLORS.length), CHILD_COLORS[0]);
  assert.equal(childColor(-1), CHILD_COLORS.at(-1));
});

test("child colors fall back safely for invalid indexes", () => {
  assert.equal(childColor(Number.NaN), CHILD_COLORS[0]);
  assert.equal(childColor(Number.POSITIVE_INFINITY), CHILD_COLORS[0]);
});
