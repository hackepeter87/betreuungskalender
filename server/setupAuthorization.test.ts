import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole, type RequestUser } from "./auth.js";
import {
  isNativeOwnerSetupUser,
  isTrustedProxySetupAdmin
} from "./services/setupAuthorization.js";

function user(role: RequestUser["role"], overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: `user-${role}`,
    externalSubject: `subject-${role}`,
    displayName: role,
    groups: [],
    role,
    permissions: permissionsForRole(role),
    ...overrides
  };
}

test("native first-use setup requires an active owner session", () => {
  assert.equal(isNativeOwnerSetupUser(user("admin", {
    workspaceAccess: true,
    isOwner: true
  })), true);
  assert.equal(isNativeOwnerSetupUser(user("admin", {
    workspaceAccess: true,
    isOwner: false
  })), false);
  assert.equal(isNativeOwnerSetupUser(user("admin", {
    workspaceAccess: false,
    isOwner: true
  })), false);
  assert.equal(isNativeOwnerSetupUser(undefined), false);
});

test("trusted-proxy first-use setup requires an explicit admin identity", () => {
  assert.equal(isTrustedProxySetupAdmin({
    authenticated: true,
    user: user("admin")
  }), true);
  assert.equal(isTrustedProxySetupAdmin({
    authenticated: true,
    user: user("parent")
  }), false);
  assert.equal(isTrustedProxySetupAdmin({
    authenticated: true,
    user: user("readonly")
  }), false);
  assert.equal(isTrustedProxySetupAdmin({
    authenticated: true,
    reason: "missing_role",
    user: user("readonly")
  }), false);
});
