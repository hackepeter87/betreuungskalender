import assert from "node:assert/strict";
import test from "node:test";
import {
  demoCountdown,
  formatDemoCountdown
} from "../src/lib/demoLifecycle.js";

test("demo countdown uses elapsed server time instead of the client wall clock", () => {
  const countdown = demoCountdown(
    "2026-11-08T12:00:00.000Z",
    "2026-11-08T11:50:00.000Z",
    90_000
  );
  assert.deepEqual(countdown, {
    remainingSeconds: 510,
    urgent: false,
    expired: false
  });
});

test("demo countdown marks the final five minutes without marking expiry", () => {
  assert.deepEqual(
    demoCountdown(
      "2026-11-08T12:00:00.000Z",
      "2026-11-08T11:55:00.000Z",
      0
    ),
    { remainingSeconds: 300, urgent: true, expired: false }
  );
});

test("demo countdown fails closed for due and malformed lifecycle values", () => {
  assert.equal(demoCountdown(
    "2026-11-08T12:00:00.000Z",
    "2026-11-08T11:59:59.500Z",
    500
  ).expired, true);
  assert.equal(demoCountdown("invalid", "invalid", 0).expired, true);
  assert.equal(formatDemoCountdown(300), "5:00");
  assert.equal(formatDemoCountdown(-1), "0:00");
});
