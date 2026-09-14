import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkspaceQueryLimitError,
  withinResultLimit
} from "./services/boundedQueries.js";

test("bounded query results accept the exact limit and reject one row above it", () => {
  assert.deepEqual(withinResultLimit(["a", "b"], 2), ["a", "b"]);
  assert.throws(
    () => withinResultLimit(["a", "b", "c"], 2),
    WorkspaceQueryLimitError
  );
});

test("bounded query results reject invalid configured limits", () => {
  assert.throws(() => withinResultLimit([], 0), WorkspaceQueryLimitError);
  assert.throws(() => withinResultLimit([], Number.NaN), WorkspaceQueryLimitError);
});
