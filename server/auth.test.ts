import assert from "node:assert/strict";
import test from "node:test";
import {
  displayNameForIdentity,
  requestIdentity,
  resolveRequestUser,
  roleFromGroups,
  sessionInfo,
  workspacePermissionsForRole,
  userFromClaims
} from "./auth.js";

test("reads supported proxy identity headers in priority order", () => {
  assert.equal(
    requestIdentity({
      "x-auth-request-email": " user@example.net ",
      "x-forwarded-user": "fallback"
    }),
    "user@example.net"
  );
});

test("keeps local development open even when proxy IP trust is enabled", () => {
  const auth = resolveRequestUser(
    {},
    {
      requireAuth: false,
      trustProxyAuth: true,
      userIdHeader: "x-auth-request-user",
      emailHeader: "x-auth-request-email",
      displayNameHeader: "x-auth-request-preferred-username",
      groupsHeader: "x-auth-request-groups",
      adminGroup: "/betreuungskalender/admins",
      parentGroup: "/betreuungskalender/parents",
      readonlyGroup: "/betreuungskalender/readers",
      requireRoleClaim: true
    }
  );
  assert.equal(auth.authenticated, true);
  assert.equal(auth.user?.id, "local-dev");
  assert.equal(auth.user?.role, "admin");
});

test("derives compact display names without exposing extra identity details", () => {
  assert.equal(displayNameForIdentity(" user@example.net "), "user");
  assert.equal(displayNameForIdentity("Example User"), "Example User");
  assert.equal(displayNameForIdentity("\u0000".repeat(4)), "authenticated-user");
});

test("reports authenticated session metadata only when proxy identity is trusted", () => {
  assert.deepEqual(
    sessionInfo(
      { "x-auth-request-email": "parent@example.net" },
      {
        requireAuth: true,
        trustProxyAuth: true,
        authLogoutUrl: "/oauth2/sign_out"
      }
    ),
    {
      authRequired: true,
      authenticated: true,
      user: {
        id: "user_01b9145fc4d17eb1e251b5e9",
        displayName: "parent",
        role: "parent",
        email: "parent@example.net"
      },
      logoutUrl: "/oauth2/sign_out"
    }
  );

  assert.deepEqual(
    sessionInfo(
      { "x-auth-request-email": "parent@example.net" },
      { requireAuth: false, trustProxyAuth: false }
    ),
    {
      authRequired: false,
      authenticated: false
    }
  );
});

test("maps claim-derived headers to stable internal users and permissions", () => {
  const auth = resolveRequestUser(
    {
      "x-auth-request-user": "subject-123",
      "x-auth-request-email": "parent@example.net",
      "x-auth-request-preferred-username": "Example Parent",
      "x-auth-request-groups": "/betreuungskalender/parents,/other"
    },
    {
      requireAuth: true,
      trustProxyAuth: true,
      userIdHeader: "x-auth-request-user",
      emailHeader: "x-auth-request-email",
      displayNameHeader: "x-auth-request-preferred-username",
      groupsHeader: "x-auth-request-groups",
      adminGroup: "/betreuungskalender/admins",
      parentGroup: "/betreuungskalender/parents",
      readonlyGroup: "/betreuungskalender/readers",
      requireRoleClaim: true
    }
  );
  assert.equal(auth.authenticated, true);
  assert.equal(auth.user?.id, "user_e8725703d28a2972830e5502");
  assert.equal(auth.user?.email, "parent@example.net");
  assert.equal(auth.user?.displayName, "Example Parent");
  assert.equal(auth.user?.role, "parent");
  assert.deepEqual(auth.user?.permissions, ["read", "write"]);
});

test("derives roles from configured OIDC groups", () => {
  const options = {
    adminGroup: "admins",
    parentGroup: "parents",
    readonlyGroup: "readers",
    requireRoleClaim: true
  };
  assert.equal(roleFromGroups(["admins", "parents"], options), "admin");
  assert.equal(roleFromGroups(["parents"], options), "parent");
  assert.equal(roleFromGroups(["readers"], options), "readonly");
  assert.equal(roleFromGroups(["unknown"], options), undefined);
  assert.equal(roleFromGroups([], { ...options, requireRoleClaim: false }), "parent");
});

test("maps native OIDC claims to stable users and role permissions", () => {
  const options = {
    adminGroup: "/betreuungskalender/admins",
    parentGroup: "/betreuungskalender/parents",
    readonlyGroup: "/betreuungskalender/readers",
    requireRoleClaim: true
  };

  const admin = userFromClaims({
    subject: "subject-admin",
    email: "admin@example.net",
    displayName: "Admin User",
    groups: ["/betreuungskalender/admins", "/betreuungskalender/parents"]
  }, options);
  assert.equal(admin.authenticated, true);
  assert.equal(admin.user?.role, "admin");
  assert.deepEqual(admin.user?.permissions, ["read", "write", "admin"]);
  assert.equal(admin.user?.externalSubject, "subject-admin");
  assert.equal(admin.user?.email, "admin@example.net");
  assert.equal(admin.user?.displayName, "Admin User");

  const readonly = userFromClaims({
    subject: "subject-reader",
    groups: ["/betreuungskalender/readers"]
  }, options);
  assert.equal(readonly.user?.role, "readonly");
  assert.deepEqual(readonly.user?.permissions, ["read"]);

  const missing = userFromClaims({
    subject: "subject-unknown",
    groups: ["/other"]
  }, options);
  assert.deepEqual(missing, { authenticated: false, reason: "missing_role" });
});

test("workspace roles expose the fixed permission matrix", () => {
  const owner = workspacePermissionsForRole("admin", true);
  const admin = workspacePermissionsForRole("admin");
  const editor = workspacePermissionsForRole("editor");
  const scheduler = workspacePermissionsForRole("scheduler");
  const viewer = workspacePermissionsForRole("viewer");

  assert.equal(owner.includes("members:manage"), true);
  assert.equal(owner.includes("admin:destructive"), true);
  assert.equal(admin.includes("settings:manage"), true);
  assert.equal(admin.includes("exports:run"), true);
  assert.equal(admin.includes("members:manage"), false);
  assert.equal(admin.includes("admin:destructive"), false);
  assert.equal(editor.includes("children:view-sensitive"), true);
  assert.equal(editor.includes("planning:manage"), true);
  assert.equal(editor.includes("settings:view"), false);
  assert.deepEqual(scheduler, [
    "appointments:view",
    "appointments:create",
    "appointments:edit",
    "children:view-basic",
    "notifications:manage-own"
  ]);
  assert.deepEqual(viewer, [
    "appointments:view",
    "children:view-basic",
    "notifications:manage-own"
  ]);
});
