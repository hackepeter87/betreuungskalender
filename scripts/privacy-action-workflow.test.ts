import assert from "node:assert/strict";
import test from "node:test";
import {
  privacyCategoryOptions,
  setPrivacyActionSelection
} from "../src/lib/privacyActionWorkflow";

test("offers only subject-specific privacy categories and actions", () => {
  assert.deepEqual(
    privacyCategoryOptions("user").map(({ code, actions }) => [code, actions]),
    [
      ["access", ["revoke"]],
      ["authentication_identity", ["detach", "anonymize"]],
      ["runtime_channels", ["revoke", "delete"]],
      ["domain_relationships", ["delete"]],
      ["historical_attribution", ["anonymize"]],
      ["transfer_state", ["anonymize", "delete"]]
    ]
  );
  assert.deepEqual(
    privacyCategoryOptions("child").map(({ code }) => code),
    ["profile", "domain_relationships", "domain_records", "historical_attribution"]
  );
  assert.deepEqual(
    privacyCategoryOptions("care_party").map(({ code }) => code),
    ["profile", "domain_relationships", "domain_records", "historical_attribution"]
  );
});

test("replaces or removes one category decision without mutating the input", () => {
  const initial = [
    { category: "profile" as const, action: "anonymize" as const },
    { category: "historical_attribution" as const, action: "anonymize" as const }
  ];
  const changed = setPrivacyActionSelection(initial, "profile", "delete");
  const retained = setPrivacyActionSelection(changed, "historical_attribution", "retain");

  assert.deepEqual(initial, [
    { category: "profile", action: "anonymize" },
    { category: "historical_attribution", action: "anonymize" }
  ]);
  assert.deepEqual(changed, [
    { category: "profile", action: "delete" },
    { category: "historical_attribution", action: "anonymize" }
  ]);
  assert.deepEqual(retained, [{ category: "profile", action: "delete" }]);
});
